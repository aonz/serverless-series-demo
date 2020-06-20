import * as util from 'util';

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
  try {
    const { id, quantity } = event;
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
    return { message: 'Shipping was created.' };
  } catch (error) {
    log('Error', error);
    throw error;
  }
};
