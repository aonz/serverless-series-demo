import * as cdk from '@aws-cdk/core';
import * as apigateway from '@aws-cdk/aws-apigateway';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as rds from '@aws-cdk/aws-rds';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

import * as path from 'path';

export class ServerlessSeriesPart3Stack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const name = 'ServerlessSeriesPart3';
    const identifier = name.toLowerCase();

    // Shared Infrastructure
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

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', { apiName: name });
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
      ],
    });

    // Monolith
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

    // Microservices - Request/Response
    const privateHttpApi = new apigateway.RestApi(this, 'PrivateHttpApi', {
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
        PAYMENT_URL: `${privateHttpApi.url}payment`,
        SHIPPING_URL: `${privateHttpApi.url}shipping`,
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
    privateHttpApi.root.addResource('payment').addProxy({
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
    privateHttpApi.root.addResource('shipping').addProxy({
      defaultIntegration: new apigateway.LambdaIntegration(rrShippingFn),
    });
  }
}
