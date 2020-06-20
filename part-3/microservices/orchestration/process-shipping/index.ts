import * as util from 'util';

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
  try {
    const { id, quantity } = event;
    const status = quantity <= 100 ? 'Processed' : 'Exceeded';
    await data.query('UPDATE shipping SET `status` = :status WHERE id = :id', { id, status });
    if (status === 'Exceeded') {
      const error = new Error('Exceeds shipping quantity limit.');
      log('Error - Make shipping', error);
      return { message: '', error: 'Exceeds shipping quantity limit.', status: 'OnHold' };
    }
    return { message: 'Shipping was processed.' };
  } catch (error) {
    log('Error', error);
    throw error;
  }
};
