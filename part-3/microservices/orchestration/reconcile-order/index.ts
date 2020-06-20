import * as util from 'util';

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
  try {
    const { id, status } = event;
    await data.query('UPDATE `order` SET `status` = :status WHERE id = :id', { id, status });
    return { message: 'Order was reconciled.' };
  } catch (error) {
    log('Error', error);
    throw error;
  }
};
