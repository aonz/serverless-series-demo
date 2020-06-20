import * as util from 'util';

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
  try {
    const { id, amount } = event;
    if (amount < 0) {
      throw new InvalidPaymentError('Invalid payment amount.');
    }
    await data.query('INSERT INTO payment (id, `status`, amount) VALUES(:id, :status, :amount)', {
      id,
      status: 'Pending',
      amount,
    });
    return { message: 'Payment was created.' };
  } catch (error) {
    log('Error', error);
    throw error;
  }
};
