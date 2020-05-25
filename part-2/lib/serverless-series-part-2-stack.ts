import * as cdk from '@aws-cdk/core';
import * as apigatewayv2 from '@aws-cdk/aws-apigatewayv2';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import * as lambdaEventSources from '@aws-cdk/aws-lambda-event-sources';
import * as rds from '@aws-cdk/aws-rds';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';

import * as path from 'path';

export class ServerlessSeriesPart2Stack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const name = 'ServerlessSeriesPart2';
    const identifier = name.toLowerCase();

    // VPC
    const vpcCidr = '10.0.0.0/20';
    const vpc = new ec2.Vpc(this, 'Vpc', {
      cidr: vpcCidr,
      natGateways: 0,
      subnetConfiguration: [{ name: 'Isolated', subnetType: ec2.SubnetType.ISOLATED }],
    });
    new cdk.CfnOutput(this, 'VpcSubnetId1', { value: vpc.isolatedSubnets[0].subnetId });
    new cdk.CfnOutput(this, 'VpcSubnetId2', { value: vpc.isolatedSubnets[1].subnetId });
    new cdk.CfnOutput(this, 'VpcSecurityGroupId', { value: vpc.vpcDefaultSecurityGroup });

    const securityGroup = new ec2.SecurityGroup(this, 'SecurityGroup', {
      securityGroupName: identifier,
      vpc,
    });
    securityGroup.addIngressRule(ec2.Peer.ipv4(vpcCidr), ec2.Port.allTraffic());
    securityGroup.addIngressRule(securityGroup, ec2.Port.allTraffic());

    vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
      subnets: [{ subnetType: ec2.SubnetType.ISOLATED }],
    });

    vpc.addInterfaceEndpoint('RdsDataEndpoint', {
      service: new ec2.InterfaceVpcEndpointAwsService('rds-data'),
      subnets: { subnetType: ec2.SubnetType.ISOLATED },
      securityGroups: [securityGroup],
    });

    // DynamoDB
    const shopTable = new dynamodb.Table(this, 'ShopDynamoDbTable', {
      tableName: `${name}Shop`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'SK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_AND_OLD_IMAGES,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    shopTable.addGlobalSecondaryIndex({
      indexName: 'GSI1',
      partitionKey: { name: 'GSI1PK', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'GSI1SK', type: dynamodb.AttributeType.STRING },
    });

    const itemTable = new dynamodb.Table(this, 'ItemDynamoDbTable', {
      tableName: `${name}Item`,
      partitionKey: { name: 'PK', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // API Gateway -> Lambda
    const shopRole = new iam.Role(this, 'ShopRole', {
      roleName: `${name}Shop`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
      ],
    });
    const shopFn = new lambda.Function(this, 'ShopFunction', {
      functionName: `${name}Shop`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../', 'shop-function')),
      timeout: cdk.Duration.seconds(10),
      role: shopRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        SHOP_TABLE: shopTable.tableName,
        ITEM_TABLE: itemTable.tableName,
      },
    });

    const httpApi = new apigatewayv2.HttpApi(this, 'HttpApi', { apiName: name });
    new cdk.CfnOutput(this, 'HttpApiUrl', { value: <string>httpApi.url });
    httpApi.addRoutes({
      path: '/{proxy+}',
      methods: [apigatewayv2.HttpMethod.ANY],
      integration: new apigatewayv2.LambdaProxyIntegration({
        handler: shopFn,
        payloadFormatVersion: apigatewayv2.PayloadFormatVersion.VERSION_1_0,
      }),
    });

    // Aurora Serverless
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
    new cdk.CfnOutput(this, 'AuroraEndpoint', { value: auroraCluster.attrEndpointAddress });

    // DynamoDB Streams -> Lambda -> Aurora Serverless
    const streamsRole = new iam.Role(this, 'StreamsRole', {
      roleName: `${name}Streams`,
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonRDSDataFullAccess'),
        iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonDynamoDBFullAccess'),
      ],
    });
    const streamsFn = new lambda.Function(this, 'StreamsFunction', {
      functionName: `${name}Streams`,
      runtime: lambda.Runtime.NODEJS_12_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../', 'streams-function')),
      timeout: cdk.Duration.seconds(10),
      role: streamsRole,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.ISOLATED },
      environment: {
        ResourceArn: `arn:aws:rds:${this.region}:${this.account}:cluster:${auroraCluster.dbClusterIdentifier}`,
        SecretArn: secret.secretArn,
      },
    });
    streamsFn.addEventSource(
      new lambdaEventSources.DynamoEventSource(shopTable, {
        startingPosition: lambda.StartingPosition.TRIM_HORIZON,
        batchSize: 1,
      })
    );
  }
}
