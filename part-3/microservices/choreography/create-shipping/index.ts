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

class InvalidShippingError extends Error {
  constructor(...params: any) {
    super(...params);
    this.name = 'InvalidShippingError';
  }
}

exports.handler = async (event: any, context: any) => {
  log('Event', event);
  log('Context', context);
  const body = event.detail;
  log('body', body);
  const { id, quantity } = body;
  try {
    if (quantity < 0) {
      throw new InvalidShippingError('Invalid shipping quantity.');
    }
    await data.query(
      'INSERT INTO shipping (id, `status`, quantity) VALUES(:id, :status, :quantity)',
      {
        id,
        status: 'Pending',
        quantity,
      }
    );
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'CreateShipping',
          DetailType: 'Success',
          Detail: JSON.stringify({ id }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    return { message: 'Shipping was created.' };
  } catch (error) {
    log('Error', error);
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'CreateShipping',
          DetailType: 'Error',
          Detail: JSON.stringify({ id, error }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    throw error;
  }
};
