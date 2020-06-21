import * as cdk from '@aws-cdk/core';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as events from '@aws-cdk/aws-events';
import * as eventsTargets from '@aws-cdk/aws-events-targets';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as rds from '@aws-cdk/aws-rds';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import * as stepfunctions from '@aws-cdk/aws-stepfunctions';
import * as stepfunctionsTasks from '@aws-cdk/aws-stepfunctions-tasks';

import * as path from 'path';

export class ServerlessSeriesPart3Stack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const name = 'ServerlessSeriesPart3';
    const identifier = name.toLowerCase();

    // #region Shared Infrastructure
    const vpcCidr = '10.0.0.0/20';
    const vpc = new ec2.Vpc(this, 'Vpc', {
      cidr: vpcCidr,
      natGateways: 0,
      subnetConfiguration: [{ name: 'Isolated', subnetType: ec2.SubnetType.ISOLATED }],
    });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      securityGroupName: identifier,
      vpc,
    });
    securityGroup.addIngressRule(ec2.Peer.ipv4(vpcCidr), ec2.Port.allTraffic());
    securityGroup.addIngressRule(securityGroup, ec2.Port.allTraffic());
    new cdk.CfnOutput(this, 'SecurityGroupId', { value: securityGroup.securityGroupId });

    vpc.addInterfaceEndpoint('RdsDataEndpoint', {
      service: new ec2.InterfaceVpcEndpointAwsService('rds-data'),
      subnets: { subnetType: ec2.SubnetType.ISOLATED },
      securityGroups: [securityGroup],
    });
    vpc.addInterfaceEndpoint('ApiGatewayEndpoint', {
      service: new ec2.InterfaceVpcEndpointAwsService('execute-api'),
      subnets: { subnetType: ec2.SubnetType.ISOLATED },
      securityGroups: [securityGroup],
    });
    vpc.addInterfaceEndpoint('EventBridgeEndpoint', {
      service: new ec2.InterfaceVpcEndpointAwsService('events'),
      subnets: { subnetType: ec2.SubnetType.ISOLATED },
      securityGroups: [securityGroup],
    });

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', { apiName: `${name}HttpApi` });
    new cdk.CfnOutput(this, 'HttpApiUrl', { value: <string>httpApi.url });

    const secret = new secretsmanager.Secret(this, 'Secret', {
      secretName: `rds-db-credentials/${identifier}`,
      generateSecretString: {
        secretStringTemplate: '{"username": "admin"}',
        generateStringKey: 'password',
        excludeCharacters: '"@/',
      },
    });
    new cdk.CfnOutput(this, 'SecretsManagerArn', { value: secret.secretArn });

    const dbSubnetGroup = new rds.CfnDBSubnetGroup(this, 'DbSubnetGroup', {
      dbSubnetGroupName: identifier,
      dbSubnetGroupDescription: name,
      subnetIds: vpc.isolatedSubnets.map((s) => s.subnetId),
    });

    const auroraCluster = new rds.CfnDBCluster(this, 'AuroraCluster', {
      dbClusterIdentifier: identifier,
      dbSubnetGroupName: dbSubnetGroup.dbSubnetGroupName,
      vpcSecurityGroupIds: [securityGroup.securityGroupId],
      databaseName: 'shop',
      engine: 'aurora',
      engineMode: 'serverless',
      masterUsername: `{{resolve:secretsmanager:${secret.secretArn}:SecretString:username}}`,
      masterUserPassword: `{{resolve:secretsmanager:${secret.secretArn}:SecretString:password}}`,
      scalingConfiguration: {
        autoPause: true,
        maxCapacity: 1,
        minCapacity: 1,
        secondsUntilAutoPause: 3600,
      },
      enableHttpEndpoint: true,
    });
    auroraCluster.addDependsOn(dbSubnetGroup);
    auroraCluster.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    new cdk.CfnOutput(this, 'AuroraEndpoint', { value: auroraCluster.attrEndpointAddress });

    const lambdaRole = new iam.Role(this, 'LambdaRole', {
      roleName: `${name}Lambda`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonRDSDataFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonEventBridgeFullAccess'),
      ],
    });
    // #endregion Shared Infrastructure
    // #region Monolith
    const monolithFn = new lambda.Function(this, 'MonolithFunction', {
      functionName: `${name}Monolith`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../', 'monolith')),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    httpApi.addRoutes({
      path: '/monolith/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new apigatewayv2.LambdaProxyIntegration({
        handler: monolithFn,
        payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_1_0,
      }),
    });
    // #endregion Monolith
    // #region Microservices - Request/Response
    const privateRestApi = new apigateway.RestApi(this, 'PrivateRestApi', {
      restApiName: `${name}PrivateRestApi`,
      policy: new iam.PolicyDocument({
        statements: [
          new iam.PolicyStatement({
            actions: ['execute-api:Invoke'],
            resources: ['execute-api:/*/*/*'],
            principals: [new iam.AnyPrincipal()],
          }),
        ],
      }),
      endpointConfiguration: { types: [apigateway.EndpointType.PRIVATE] },
    });
    const rrOrderFn = new lambda.Function(this, 'RrOrderFunction', {
      functionName: `${name}RequestResponseOrder`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/request-response/order')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        PAYMENT_URL: `${privateRestApi.url}payment`,
        SHIPPING_URL: `${privateRestApi.url}shipping`,
      },
    });
    httpApi.addRoutes({
      path: '/microservices/request-response/order/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new apigatewayv2.LambdaProxyIntegration({
        handler: rrOrderFn,
        payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_1_0,
      }),
    });
    const rrPaymentFn = new lambda.Function(this, 'RrPaymentFunction', {
      functionName: `${name}RequestResponsePayment`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/request-response/payment')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    privateRestApi.root.addResource('payment').addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(rrPaymentFn),
    });
    const rrShippingFn = new lambda.Function(this, 'RrShippingFunction', {
      functionName: `${name}RequestResponseShipping`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/request-response/shipping')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    privateRestApi.root.addResource('shipping').addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(rrShippingFn),
    });
    // #endregion Microservices - Request/Response
    // #region Microservices - Orchestration
    const ocCreateOrderFn = new lambda.Function(this, 'OcCreateOrderFunction', {
      functionName: `${name}OrchestrationCreateOrder`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/create-order')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocProcessOrderFn = new lambda.Function(this, 'OcProcessOrderFunction', {
      functionName: `${name}OrchestrationProcessOrder`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/process-order')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocReconcileOrderFn = new lambda.Function(this, 'OcReconcileOrderFunction', {
      functionName: `${name}OrchestrationReconcileOrder`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/reconcile-order')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocCreatePaymentFn = new lambda.Function(this, 'OcCreatePaymentFunction', {
      functionName: `${name}OrchestrationCreatePayment`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/create-payment')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocProcessPaymentFn = new lambda.Function(this, 'OcProcessPaymentFunction', {
      functionName: `${name}OrchestrationProcessPayment`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/process-payment')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocReconcilePaymentFn = new lambda.Function(this, 'OcReconcilePaymentFunction', {
      functionName: `${name}OrchestrationReconcilePayment`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/reconcile-payment')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocCreateShippingFn = new lambda.Function(this, 'OcCreateShippingFunction', {
      functionName: `${name}OrchestrationCreateShipping`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/create-shipping')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocProcessShippingFn = new lambda.Function(this, 'OcProcessShippingFunction', {
      functionName: `${name}OrchestrationProcessShipping`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/process-shipping')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    const ocReconcileShippingFn = new lambda.Function(this, 'OcReconcileShippingFunction', {
      functionName: `${name}OrchestrationReconcileShipping`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/orchestration/reconcile-shipping')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
      },
    });
    // Happy Path
    const startState = new stepfunctions.Pass(this, 'Start');
    const finishState = new stepfunctions.Succeed(this, 'Finish');
    // Create
    const createOrderState = new stepfunctions.Task(this, 'Create Order', {
      task: new stepfunctionsTasks.RunLambdaTask(ocCreateOrderFn),
      parameters: {
        Payload: {
          body: '$',
          'executionId.$': '$$.Execution.Id',
        },
      },
      outputPath: '$.Payload',
    });
    const createPaymentState = new stepfunctions.Task(this, 'Create Payment', {
      task: new stepfunctionsTasks.RunLambdaTask(ocCreatePaymentFn),
      parameters: { Payload: { 'id.$': '$.id', 'amount.$': '$.amount' } },
      outputPath: '$.Payload',
    });
    const createShippingState = new stepfunctions.Task(this, 'Create Shipping', {
      task: new stepfunctionsTasks.RunLambdaTask(ocCreateShippingFn),
      parameters: { Payload: { 'id.$': '$.id', 'quantity.$': '$.quantity' } },
      outputPath: '$.Payload',
    });
    const parallelCreateState = new stepfunctions.Parallel(this, 'Parallel Create', {
      resultPath: '$.results',
    });
    parallelCreateState.branch(createPaymentState);
    parallelCreateState.branch(createShippingState);
    // Process
    const processPaymentState = new stepfunctions.Task(this, 'Process Payment', {
      task: new stepfunctionsTasks.RunLambdaTask(ocProcessPaymentFn),
      parameters: { Payload: { 'id.$': '$.id', 'amount.$': '$.amount' } },
      outputPath: '$.Payload',
    });
    const processShippingState = new stepfunctions.Task(this, 'Process Shipping', {
      task: new stepfunctionsTasks.RunLambdaTask(ocProcessShippingFn),
      parameters: { Payload: { 'id.$': '$.id', 'quantity.$': '$.quantity' } },
      outputPath: '$.Payload',
    });
    const parallelProcessState = new stepfunctions.Parallel(this, 'Parallel Process', {
      resultPath: '$.results',
    });
    parallelProcessState.branch(processPaymentState);
    parallelProcessState.branch(processShippingState);
    const processOrderState = new stepfunctions.Task(this, 'Process Order', {
      task: new stepfunctionsTasks.RunLambdaTask(ocProcessOrderFn),
      parameters: { Payload: { 'id.$': '$.id' } },
      outputPath: '$.Payload',
    });
    let definition: any;
    const ocWithErrorHandlers = true;
    if (!ocWithErrorHandlers) {
      definition = startState
        .next(createOrderState)
        .next(parallelCreateState)
        .next(parallelProcessState)
        .next(processOrderState)
        .next(finishState);
    } else {
      const errorState = new stepfunctions.Fail(this, 'Error');
      createOrderState.addCatch(errorState);
      createOrderState.addRetry({
        errors: ['RandomError'],
        interval: cdk.Duration.seconds(1),
        maxAttempts: 3,
        backoffRate: 2,
      });
      const createPaymentErrorState = new stepfunctions.Fail(this, 'Create Payment Error');
      parallelCreateState.addCatch(createPaymentErrorState, { errors: ['InvalidPaymentError'] });
      parallelCreateState.addCatch(errorState);
      parallelProcessState.addCatch(errorState);
      processOrderState.addCatch(errorState);
      // Reconcile - Payment and Shipping Errors
      const reconcileOrderAllErrorsState = new stepfunctions.Task(
        this,
        'Payment and Shipping Errors - Reconcile Order',
        {
          task: new stepfunctionsTasks.RunLambdaTask(ocReconcileOrderFn),
          parameters: { Payload: { 'id.$': '$.id', status: 'OnHold' } },
          outputPath: '$.Payload',
        }
      );
      // Reconcile - Payment Error
      const reconcileOrderPaymentErrorState = new stepfunctions.Task(
        this,
        'Payment Error - Reconcile Order',
        {
          task: new stepfunctionsTasks.RunLambdaTask(ocReconcileOrderFn),
          parameters: { Payload: { 'id.$': '$.id', 'status.$': '$.results[0].status' } },
          outputPath: '$.Payload',
        }
      );
      const reconcileShippingPaymentErrorState = new stepfunctions.Task(
        this,
        'Payment Error - Reconcile Shipping',
        {
          task: new stepfunctionsTasks.RunLambdaTask(ocReconcileShippingFn),
          parameters: { Payload: { 'id.$': '$.id', 'status.$': '$.results[0].status' } },
          outputPath: '$.Payload',
        }
      );
      const parallelReconcilePaymentErrorState = new stepfunctions.Parallel(
        this,
        'Parallel Reconcile - Payment Error',
        { resultPath: '$.Payload.results', outputPath: '$.Payload' }
      );
      parallelReconcilePaymentErrorState.branch(reconcileOrderPaymentErrorState);
      parallelReconcilePaymentErrorState.branch(reconcileShippingPaymentErrorState);
      parallelReconcilePaymentErrorState.addCatch(errorState);
      // Reconcile - Shipping Error
      const reconcileOrderShippingErrorState = new stepfunctions.Task(
        this,
        'Shipping Error - Reconcile Order',
        {
          task: new stepfunctionsTasks.RunLambdaTask(ocReconcileOrderFn),
          parameters: { Payload: { 'id.$': '$.id', 'status.$': '$.results[1].status' } },
          outputPath: '$.Payload',
        }
      );
      const reconcilePaymentShippingErrorState = new stepfunctions.Task(
        this,
        'Shipping Error - Reconcile Payment',
        {
          task: new stepfunctionsTasks.RunLambdaTask(ocReconcilePaymentFn),
          parameters: { Payload: { 'id.$': '$.id', 'status.$': '$.results[1].status' } },
          outputPath: '$.Payload',
        }
      );
      const parallelReconcileShippingErrorState = new stepfunctions.Parallel(
        this,
        'Parallel Reconcile - Shipping Error',
        { resultPath: '$.Payload.results', outputPath: '$.Payload' }
      );
      parallelReconcileShippingErrorState.branch(reconcileOrderShippingErrorState);
      parallelReconcileShippingErrorState.branch(reconcilePaymentShippingErrorState);
      parallelReconcileShippingErrorState.addCatch(errorState);
      const choiceState = new stepfunctions.Choice(this, 'Check Results');
      choiceState.when(
        stepfunctions.Condition.and(
          stepfunctions.Condition.stringEquals('$.results[0].message', ''),
          stepfunctions.Condition.stringEquals('$.results[1].message', '')
        ),
        reconcileOrderAllErrorsState
      );
      choiceState.when(
        stepfunctions.Condition.stringEquals('$.results[0].message', ''),
        parallelReconcilePaymentErrorState
      );
      choiceState.when(
        stepfunctions.Condition.stringEquals('$.results[1].message', ''),
        parallelReconcileShippingErrorState
      );
      choiceState.otherwise(processOrderState);
      definition = startState
        .next(createOrderState)
        .next(parallelCreateState)
        .next(parallelProcessState)
        .next(choiceState.afterwards())
        .next(finishState);
    }
    const stateMachineRole = new iam.Role(this, 'StateMachineRole', {
      roleName: `${name}StateMachineRole`,
      assumedBy: new iam.ServicePrincipal('states.amazonaws.com'),
      managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaRole')],
    });
    const stateMachine = new stepfunctions.StateMachine(this, 'StateMachine', {
      stateMachineName: 'StepFunctionDemo-StateMachine',
      definition,
      timeout: cdk.Duration.minutes(1),
      role: stateMachineRole,
    });
    const restApi = new apigateway.RestApi(this, 'RestApi', {
      restApiName: `${name}RestApi`,
      endpointConfiguration: { types: [apigateway.EndpointType.REGIONAL] },
    });
    const restApiRole = new iam.Role(this, 'RestApiRole', {
      roleName: `${name}RestApiRole`,
      assumedBy: new iam.ServicePrincipal('apigateway.amazonaws.com'),
    });
    stateMachine.grantStartExecution(restApiRole);
    const integration = new apigateway.AwsIntegration({
      service: 'states',
      action: 'StartExecution',
      options: {
        credentialsRole: restApiRole,
        requestTemplates: {
          'application/json': JSON.stringify({
            stateMachineArn: stateMachine.stateMachineArn,
            input: `$util.escapeJavaScript($input.json('$'))`,
          }),
        },
        passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
        integrationResponses: [
          {
            statusCode: '200',
            responseTemplates: { 'application/json': "$input.json('$')" },
            // responseTemplates: {
            //   'application/json': JSON.stringify({
            //     token: `$input.json('$.executionArn').split(':')[7].replaceAll('"', '')`,
            //   }),
            // },
          },
        ],
      },
    });
    restApi.root
      .addResource('microservices')
      .addResource('orchestration')
      .addResource('order')
      .addResource('create-order')
      .addMethod('POST', integration, {
        methodResponses: [
          {
            statusCode: '200',
            responseModels: { 'application/json': new apigateway.EmptyModel() },
          },
        ],
      });
    // #endregion Microservices - Orchestration
    // #region Microservices - Choreography
    const eventBus = new events.EventBus(this, 'EventBus', { eventBusName: name });
    const crOrderContextFn = new lambda.Function(this, 'CrOrderContextFunction', {
      functionName: `${name}ChoreographyOrderContext`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/order-context')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crCreateOrderFn = new lambda.Function(this, 'CrCreateOrderFunction', {
      functionName: `${name}ChoreographyCreateOrder`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/create-order')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crProcessOrderFn = new lambda.Function(this, 'CrProcessOrderFunction', {
      functionName: `${name}ChoreographyProcessOrder`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/process-order')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crReconcileOrderFn = new lambda.Function(this, 'CrReconcileOrderFunction', {
      functionName: `${name}ChoreographyReconcileOrder`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/reconcile-order')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crCreatePaymentFn = new lambda.Function(this, 'CrCreatePaymentFunction', {
      functionName: `${name}ChoreographyCreatePayment`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/create-payment')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crProcessPaymentFn = new lambda.Function(this, 'CrProcessPaymentFunction', {
      functionName: `${name}ChoreographyProcessPayment`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/process-payment')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crReconcilePaymentFn = new lambda.Function(this, 'CrReconcilePaymentFunction', {
      functionName: `${name}ChoreographyReconcilePayment`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/reconcile-payment')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crCreateShippingFn = new lambda.Function(this, 'CrCreateShippingFunction', {
      functionName: `${name}ChoreographyCreateShipping`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/create-shipping')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crProcessShippingFn = new lambda.Function(this, 'CrProcessShippingFunction', {
      functionName: `${name}ChoreographyProcessShipping`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/process-shipping')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const crReconcileShippingFn = new lambda.Function(this, 'CrReconcileShippingFunction', {
      functionName: `${name}ChoreographyReconcileShipping`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(
        path.join(__dirname, '../', 'microservices/choreography/reconcile-shipping')
      ),
      timeout: cdk.Duration.seconds(10),
      role: lambdaRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        RESOURCE_ARN: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SECRET_ARN: secret.secretArn,
        EVENT_BUS_NAME: eventBus.eventBusName,
      },
    });
    const event = events.RuleTargetInput.fromEventPath('$');
    new events.Rule(this, 'CreateOrderRule', {
      ruleName: `${name}CreateOrder`,
      eventBus,
      eventPattern: { source: ['OrderContext'], detailType: ['CreateOrder'] },
      targets: [new eventsTargets.LambdaFunction(crCreateOrderFn, { event })],
    });
    new events.Rule(this, 'CreatePaymentRule', {
      ruleName: `${name}CreatePayment`,
      eventBus,
      eventPattern: { source: ['OrderContext'], detailType: ['CreatePayment'] },
      targets: [new eventsTargets.LambdaFunction(crCreatePaymentFn, { event })],
    });
    new events.Rule(this, 'CreateShippingRule', {
      ruleName: `${name}CreateShipping`,
      eventBus,
      eventPattern: { source: ['OrderContext'], detailType: ['CreateShipping'] },
      targets: [new eventsTargets.LambdaFunction(crCreateShippingFn, { event })],
    });
    new events.Rule(this, 'ProcessOrderRule', {
      ruleName: `${name}ProcessOrder`,
      eventBus,
      eventPattern: { source: ['OrderContext'], detailType: ['ProcessOrder'] },
      targets: [new eventsTargets.LambdaFunction(crProcessOrderFn, { event })],
    });
    new events.Rule(this, 'ProcessPaymentRule', {
      ruleName: `${name}ProcessPayment`,
      eventBus,
      eventPattern: { source: ['OrderContext'], detailType: ['ProcessPayment'] },
      targets: [new eventsTargets.LambdaFunction(crProcessPaymentFn, { event })],
    });
    new events.Rule(this, 'ProcessShippingRule', {
      ruleName: `${name}ProcessShipping`,
      eventBus,
      eventPattern: { source: ['OrderContext'], detailType: ['ProcessShipping'] },
      targets: [new eventsTargets.LambdaFunction(crProcessShippingFn, { event })],
    });
    const source = [
      'CreateOrder',
      'CreatePayment',
      'CreateShipping',
      'ProcessOrder',
      'ProcessPayment',
      'ProcessShipping',
    ];
    const detailType = ['Success'];
    const crWithErrorHandlers = true;
    if (crWithErrorHandlers) {
      source.push('ReconcileOrder', 'ReconcilePayment', 'ReconcileShipping');
      detailType.push('Reconcile', 'Error');
      new events.Rule(this, 'ReconcileOrderRule', {
        ruleName: `${name}ReconcileOrder`,
        eventBus,
        eventPattern: { source: ['OrderContext'], detailType: ['ReconcileOrder'] },
        targets: [new eventsTargets.LambdaFunction(crReconcileOrderFn, { event })],
      });
      new events.Rule(this, 'ReconcilePaymentRule', {
        ruleName: `${name}ReconcilePayment`,
        eventBus,
        eventPattern: { source: ['OrderContext'], detailType: ['ReconcilePayment'] },
        targets: [new eventsTargets.LambdaFunction(crReconcilePaymentFn, { event })],
      });
      new events.Rule(this, 'ReconcileShippingRule', {
        ruleName: `${name}ReconcileShipping`,
        eventBus,
        eventPattern: { source: ['OrderContext'], detailType: ['ReconcileShipping'] },
        targets: [new eventsTargets.LambdaFunction(crReconcileShippingFn, { event })],
      });
    }
    new events.Rule(this, 'CreateOrderContextRule', {
      ruleName: `${name}OrderContext`,
      eventBus,
      eventPattern: { source, detailType },
      targets: [new eventsTargets.LambdaFunction(crOrderContextFn, { event })],
    });
    httpApi.addRoutes({
      path: '/microservices/choreography/order/create-order',
      methods: [apigatewayv2.HttpMethod.POST],
      integration: new apigatewayv2.LambdaProxyIntegration({
        handler: crOrderContextFn,
        payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_2_0,
      }),
    });
    // #endregion Microservices - Choreography
  }
}
