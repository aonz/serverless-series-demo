import * as AWS from 'aws-sdk';
import * as util from 'util';

const eventbridge = new AWS.EventBridge();

function log(message: string, item: any) {
  console.log(`${message}:\n ${util.inspect(item, { showHidden: false, depth: null })}`);
}

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'payment',
});

class InvalidPaymentError extends Error {
  constructor(...params: any) {
    super(...params);
    this.name = 'InvalidPaymentError';
  }
}

exports.handler = async (event: any, context: any) => {
  log('Event', event);
  log('Context', context);
  const body = event.detail;
  log('body', body);
  const { id, amount } = body;
  try {
    if (amount < 0) {
      throw new InvalidPaymentError('Invalid payment amount.');
    }
    await data.query('INSERT INTO payment (id, `status`, amount) VALUES(:id, :status, :amount)', {
      id,
      status: 'Pending',
      amount,
    });
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'CreatePayment',
          DetailType: 'Success',
          Detail: JSON.stringify({ id }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    return { message: 'Payment was created.' };
  } catch (error) {
    log('Error', error);
    // Send Event(s)
    const params = {
      Entries: [
        {
          EventBusName: process.env.EVENT_BUS_NAME,
          Source: 'CreatePayment',
          DetailType: 'Error',
          Detail: JSON.stringify({ id, error }),
        },
      ],
    };
    await eventbridge.putEvents(params).promise();
    throw error;
  }
};
