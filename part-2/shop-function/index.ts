export {};
const AWS = require('aws-sdk');
const dynamodb = new AWS.DynamoDB({ region: process.env.AWS_REGION || 'us-east-1' });

exports.handler = async (event: any, context: any) => {
  console.log(`Event:\n ${JSON.stringify(event, null, 2)}`);
  console.log(`Context:\n ${JSON.stringify(context, null, 2)}`);
  try {
    const params = {
      TableName: process.env.ShopTable,
    };
    const response = await dynamodb.describeTable(params).promise();
    console.log(`Response:\n ${JSON.stringify(response, null, 2)}`);
  } catch (error) {
    console.log(`Error:\n ${JSON.stringify(error, null, 2)}`);
  }
  return {
    statusCode: 200,
    body: 'Shop',
  };
};
