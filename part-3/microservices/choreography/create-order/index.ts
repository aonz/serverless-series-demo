import * as AWS from 'aws-sdk';
import * as util from 'util';

const eventbridge = new AWS.EventBridge();

function log(message: string, item: any) {
  console.log(`${message}:\n ${util.inspect(item, { showHidden: false, depth: null })}`);
}

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'order',
});

exports.handler = async (event: any, context: any) => {
  log('Event', event);
  log('Context', context);
  const body = event.detail;
  log('body', body);
  const { id } = body;
  try {
    await data.query('INSERT INTO `order` (id, `status`) VALUES(:id, :status)', {
      id,
      status: 'Pending',
    });
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'CreateOrder',
          DetailType: 'Success',
          Detail: JSON.stringify({ id }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    return { message: 'Order was created.' };
  } catch (error) {
    log('Error', error);
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'CreateOrder',
          DetailType: 'Error',
          Detail: JSON.stringify({ id, error }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    throw error;
  }
};
