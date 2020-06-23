import * as AWS from 'aws-sdk';
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

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
  try {
    if (event.body) {
      // API Gateway Event
      const body = JSON.parse(event.body);
      log('body', body);
      const { amount, quantity } = body;
      // Update Context
      const id = uuidv4();
      log('id', id);
      await data.query(
        'INSERT INTO context (id, amount, quantity) VALUES(:id, :amount, :quantity)',
        { id, amount, quantity }
      );
      // Send Event(s)
      log('Send Event(s)', ['CreateOrder']);
      const params = {
        Entries: [
          {
            EventBusName: process.env.EVENT_BUS_NAME,
            Source: 'OrderContext',
            DetailType: 'CreateOrder',
            Detail: JSON.stringify({ id }),
          },
        ],
      };
      await eventbridge.putEvents(params).promise();
      return { id, amount, quantity, results: [{ message: 'Order was created.' }] };
    }
    // EventBridge Event
    const body = event.detail;
    log('body', body);
    const { source } = event;
    const detailType = event['detail-type'];
    if (detailType === 'Error') {
      log('Error', body.error);
    } else if (source === 'CreateOrder' && detailType === 'Success') {
      // Update Context
      const { id } = body;
      await data.query('UPDATE context SET `order` = :order WHERE id = :id', {
        id,
        order: 'Created',
      });
      // Send Event(s)
      const result = await data.query('SELECT * FROM context WHERE id = :id', { id });
      const context = result.records[0];
      log('context', context);
      const { amount, quantity } = context;
      log('Send Event(s)', ['OrderCreated']);
      const params = {
        Entries: [
          {
            EventBusName: process.env.EVENT_BUS_NAME,
            Source: 'OrderContext',
            DetailType: 'OrderCreated',
            Detail: JSON.stringify({ id, amount, quantity }),
          },
        ],
      };
      await eventbridge.putEvents(params).promise();
    } else if (
      (source === 'CreatePayment' || source === 'CreateShipping') &&
      detailType === 'Success'
    ) {
      const column = source === 'CreatePayment' ? 'payment' : 'shipping';
      const { id } = body;
      await data.query(`UPDATE context SET ${column} = :status WHERE id = :id`, {
        id,
        status: 'Created',
      });
      // Send Event(s)
      const result = await data.query('SELECT * FROM context WHERE id = :id', { id });
      const context = result.records[0];
      log('context', context);
      const { payment, shipping, amount, quantity } = context;
      if (payment === 'Created' && shipping === 'Created') {
        log('Send Event(s)', ['ProcessPayment', 'ProcessShipping']);
        const params = {
          Entries: [
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ProcessPayment',
              Detail: JSON.stringify({ id, amount }),
            },
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ProcessShipping',
              Detail: JSON.stringify({ id, quantity }),
            },
          ],
        };
        await eventbridge.putEvents(params).promise();
      }
      // } else if (
      //   (source === 'ProcessPayment' || source === 'ProcessShipping') &&
      //   detailType === 'Success'
      // ) {
      //   const column = source === 'ProcessPayment' ? 'payment' : 'shipping';
      //   const { id } = body;
      //   await data.query(`UPDATE context SET ${column} = :status WHERE id = :id`, {
      //     id,
      //     status: 'Processed',
      //   });
      //   // Send Event(s)
      //   const result = await data.query('SELECT * FROM context WHERE id = :id', { id });
      //   const context = result.records[0];
      //   log('context', context);
      //   const { payment, shipping } = context;
      //   if (payment === 'Processed' && shipping === 'Processed') {
      //     log('Send Event(s)', ['ProcessOrder']);
      //     const params = {
      //       Entries: [
      //         {
      //           EventBusName: process.env.EVENT_BUS_NAME,
      //           Source: 'OrderContext',
      //           DetailType: 'ProcessOrder',
      //           Detail: JSON.stringify({ id }),
      //         },
      //       ],
      //     };
      //     await eventbridge.putEvents(params).promise();
      //   }
    } else if (
      (source === 'ProcessPayment' || source === 'ProcessShipping') &&
      (detailType === 'Success' || detailType === 'Reconcile')
    ) {
      const column = source === 'ProcessPayment' ? 'payment' : 'shipping';
      const status = detailType === 'Success' ? 'Processed' : 'Error';
      const { id } = body;
      await data.query(`UPDATE context SET ${column} = :status WHERE id = :id`, {
        id,
        status,
      });
      // Send Event(s)
      const result = await data.query('SELECT * FROM context WHERE id = :id', { id });
      const context = result.records[0];
      log('context', context);
      const { payment, shipping } = context;
      if (payment === 'Processed' && shipping === 'Processed') {
        log('Send Event(s)', ['ProcessOrder']);
        const params = {
          Entries: [
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ProcessOrder',
              Detail: JSON.stringify({ id }),
            },
          ],
        };
        await eventbridge.putEvents(params).promise();
      } else if (payment === 'Error' && shipping === 'Error') {
        log('Send Event(s)', ['ReconcileOrder']);
        const params = {
          Entries: [
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ReconcileOrder',
              Detail: JSON.stringify({ id, status: 'OnHold' }),
            },
          ],
        };
        await eventbridge.putEvents(params).promise();
      } else if (payment === 'Error' && shipping === 'Processed') {
        log('Send Event(s)', ['ReconcileOrder', 'ReconcileShipping']);
        const params = {
          Entries: [
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ReconcileOrder',
              Detail: JSON.stringify({ id, status: 'OnHold' }),
            },
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ReconcileShipping',
              Detail: JSON.stringify({ id, status: 'OnHold' }),
            },
          ],
        };
        await eventbridge.putEvents(params).promise();
      } else if (payment === 'Processed' && shipping === 'Error') {
        log('Send Event(s)', ['ReconcileOrder', 'ReconcilePayment']);
        const params = {
          Entries: [
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ReconcileOrder',
              Detail: JSON.stringify({ id, status: 'OnHold' }),
            },
            {
              EventBusName: process.env.EVENT_BUS_NAME,
              Source: 'OrderContext',
              DetailType: 'ReconcilePayment',
              Detail: JSON.stringify({ id, status: 'OnHold' }),
            },
          ],
        };
        await eventbridge.putEvents(params).promise();
      }
    } else if (source === 'ProcessOrder' && detailType === 'Success') {
      const { id } = body;
      await data.query('UPDATE context SET `order` = :order WHERE id = :id', {
        id,
        order: 'Processed',
      });
      log('Order is processed', id);
    } else if (
      (source === 'ReconcileOrder' ||
        source === 'ReconcilePayment' ||
        source === 'ReconcileShipping') &&
      detailType === 'Success'
    ) {
      const column =
        source === 'ReconcileOrder'
          ? '`order`'
          : source === 'ReconcilePayment'
          ? 'payment'
          : 'shipping';
      const { id } = body;
      await data.query(`UPDATE context SET ${column} = :status WHERE id = :id`, {
        id,
        status: 'Reconciled',
      });
    }
    return;
  } catch (error) {
    log('Error', error);
    throw error;
  }
};
