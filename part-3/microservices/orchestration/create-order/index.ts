import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

function log(message: string, item: any) {
  console.log(`${message}:\n ${util.inspect(item, { showHidden: false, depth: null })}`);
}

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'order',
});

class RandomError extends Error {
  constructor(...params: any) {
    super(...params);
    this.name = 'RandomError';
  }
}

let attempt = 0;

exports.handler = async (event: any, context: any, callback: any) => {
  log('Event', event);
  log('Context', context);
  try {
    const { amount, quantity } = event;
    if (amount === 777) {
      log('attempt', attempt);
      attempt++;
      if (attempt < 3) {
        throw new RandomError('Random error.');
      } else {
        attempt = 0;
      }
    }
    const id = uuidv4();
    log('id', id);
    await data.query('INSERT INTO `order` (id, `status`) VALUES(:id, :status)', {
      id,
      status: 'Pending',
    });
    return { id, amount, quantity, results: [{ message: 'Order was created.' }] };
  } catch (error) {
    log('Error', error);
    throw error;
  }
};
