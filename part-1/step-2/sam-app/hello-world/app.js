const axios = require('axios');
const url = 'http://checkip.amazonaws.com/';
let response;

exports.lambdaHandler = async (event, context) => {
  console.log('Event: ', JSON.stringify(event, null, 2));
  console.log('Context: ', JSON.stringify(context, null, 2));
  try {
    const ret = await axios(url);
    response = {
      statusCode: 200,
      body: JSON.stringify({
        version: 1,
        message: 'hello world',
        location: ret.data.trim(),
      }),
    };
  } catch (err) {
    console.log(err);
    return err;
  }

  return response;
};
