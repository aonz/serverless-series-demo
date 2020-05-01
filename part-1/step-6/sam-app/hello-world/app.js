const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));
let lambda = new AWS.Lambda();
if (process.env.AWS_SAM_LOCAL) {
  lambda = new AWS.Lambda({ endpoint: new AWS.Endpoint('http://host.docker.internal:3001') });
}
const axios = require('axios');
const url = 'http://checkip.amazonaws.com/';
let response;

const logger = require('/opt/nodejs/logger');

exports.lambdaHandler = async (event, context) => {
  logger.log(event, context);
  try {
    const ret = await axios(url);
    const location = ret.data.trim();
    const data = await lambda
      .invoke({ FunctionName: process.env.PING_FUNCTION, Payload: JSON.stringify({ location }) })
      .promise();
    response = {
      statusCode: 200,
      body: JSON.stringify({
        version: 2,
        message: 'hello world',
        location: JSON.parse(data.Payload).location,
      }),
    };
  } catch (err) {
    console.log(err);
    return err;
  }

  return response;
};
