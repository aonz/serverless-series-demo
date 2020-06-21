import * as AWS from 'aws-sdk';
import * as util from 'util';

const eventbridge = new AWS.EventBridge();

function log(message: string, item: any) {
  console.log(`${message}:\n ${util.inspect(item, { showHidden: false, depth: null })}`);
}

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'shipping',
});

exports.handler = async (event: any, context: any) => {
  log('Event', event);
  log('Context', context);
  const body = event.detail;
  log('body', body);
  const { id, status } = body;
  try {
    await data.query('UPDATE shipping SET `status` = :status WHERE id = :id', { id, status });
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'ReconcileShipping',
          DetailType: 'Success',
          Detail: JSON.stringify({ id }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    return { message: 'Shipping was reconciled.' };
  } catch (error) {
    log('Error', error);
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'ReconcileShipping',
          DetailType: 'Error',
          Detail: JSON.stringify({ id, error }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    throw error;
  }
};
