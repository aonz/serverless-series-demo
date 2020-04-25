const AWSXRay = require('aws-xray-sdk-core');
const AWS = AWSXRay.captureAWS(require('aws-sdk'));
let lambda = new AWS.Lambda();
if (process.env.AWS_SAM_LOCAL) {
  lambda = new AWS.Lambda({ endpoint: new AWS.Endpoint('http://host.docker.internal:3001') });
}
const axios = require('axios');
const url = 'http://checkip.amazonaws.com/';
let response;

exports.lambdaHandler = async (event, context) => {
  console.log('Event: ', JSON.stringify(event, null, 2));
  console.log('Context: ', JSON.stringify(context, null, 2));
  try {
    const ret = await axios(url);
    const location = ret.data.trim();
    const data = await lambda
      .invoke({ FunctionName: process.env.PING_FUNCTION, Payload: JSON.stringify({ location }) })
      .promise();
    response = {
      statusCode: 200,
      body: JSON.stringify({
        version: 1,
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
