import * as awsServerlessExpressMiddleware from 'aws-serverless-express/middleware';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'shop',
});

const app = express();
const router = express.Router();

router.use(cors());
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));
router.use(awsServerlessExpressMiddleware.eventContext());

function log(message: string, item: any) {
  console.log(`${message}:\n ${util.inspect(item, { showHidden: false, depth: null })}`);
}

router.get('/health', (req, res) => {
  res.json({ message: 'Ok' });
});

async function createPendingRecords(id: string, amount: number, quantity: number) {
  console.log('Start - Create pending records');
  await data
    .transaction()
    .query('INSERT INTO `order` (id, `status`) VALUES(:id, :status)', {
      id,
      status: 'Pending',
    })
    .query('INSERT INTO payment (id, `status`, amount) VALUES(:id, :status, :amount)', {
      id,
      status: 'Pending',
      amount,
    })
    .query('INSERT INTO shipping (id, `status`, quantity) VALUES(:id, :status, :quantity)', {
      id,
      status: 'Pending',
      quantity,
    })
    .commit();
  console.log('Finish - Create pending records');
}

function processPayment(id: string, amount: number, transactionId: string) {
  return new Promise(async (resolve, reject) => {
    console.log('Start - Process payment');
    const status = amount <= 1000 ? 'Processed' : 'Exceeded';
    await data.executeStatement({
      sql: 'UPDATE payment SET `status` = :status WHERE id = :id',
      parameters: [
        { name: 'id', value: { stringValue: id } },
        { name: 'status', value: { stringValue: status } },
      ],
      transactionId,
    });
    if (status === 'Exceeded') {
      const error = new Error('Exceeds payment amount limit.');
      log('Error - Process payment', error);
      return reject(error);
    }
    console.log('Finish - Process payment');
    resolve();
  });
}

function processShipping(id: string, quantity: number, transactionId: string) {
  return new Promise(async (resolve, reject) => {
    console.log('Start - Make shipping');
    const status = quantity <= 100 ? 'Processed' : 'Exceeded';
    await data.executeStatement({
      sql: 'UPDATE shipping SET `status` = :status WHERE id = :id',
      parameters: [
        { name: 'id', value: { stringValue: id } },
        { name: 'status', value: { stringValue: status } },
      ],
      transactionId,
    });
    if (status === 'Exceeded') {
      const error = new Error('Exceeds shipping quantity limit.');
      log('Error - Make shipping', error);
      return reject(error);
    }
    console.log('Finish - Make shipping');
    resolve();
  });
}

async function processPendingRecords(id: string, amount: number, quantity: number) {
  const { transactionId } = await data.beginTransaction();
  log('transactionId', transactionId);
  try {
    console.log('Start - Process pending records');
    // Process payment.
    const payment = processPayment(id, amount, transactionId);
    // Process shipping.
    const shipping = processShipping(id, quantity, transactionId);
    const results = await Promise.allSettled([payment, shipping]);
    log('results', results);
    // Reconcile records.
    await reconcileRecords(id, results[0].status, results[1].status, transactionId);
    // Commit transaction.
    await data.commitTransaction({ transactionId });
    console.log('Finish - Process pending records');
  } catch (error) {
    await data.rollbackTransaction({ transactionId });
    log('Error - Process pending records', error);
    throw error;
  }
}

async function reconcileRecords(
  id: string,
  paymentStatus: string,
  shippingStatus: string,
  transactionId: string
) {
  let status = 'Processed';
  if (paymentStatus === 'rejected' || shippingStatus === 'rejected') {
    status = 'OnHold';
    if (paymentStatus === 'rejected' && shippingStatus === 'fulfilled') {
      // Reconcile shipping record.
      await data.executeStatement({
        sql: 'UPDATE shipping SET `status` = :status WHERE id = :id',
        parameters: [
          { name: 'id', value: { stringValue: id } },
          { name: 'status', value: { stringValue: status } },
        ],
        transactionId,
      });
    }
    if (paymentStatus === 'fulfilled' && shippingStatus === 'rejected') {
      // Reconcile payment record.
      await data.executeStatement({
        sql: 'UPDATE payment SET `status` = :status WHERE id = :id',
        parameters: [
          { name: 'id', value: { stringValue: id } },
          { name: 'status', value: { stringValue: status } },
        ],
        transactionId,
      });
    }
  }
  // Update order's status to "Processed" of "OnHold".
  await data.executeStatement({
    sql: 'UPDATE `order` SET `status` = :status WHERE id = :id',
    parameters: [
      { name: 'id', value: { stringValue: id } },
      { name: 'status', value: { stringValue: status } },
    ],
    transactionId,
  });
}

router.post('/create-order', async (req, res) => {
  log('/create-order', req.body);
  const { amount, quantity } = req.body;
  const id = uuidv4();
  log('id', id);
  try {
    // Create order, payment and shipping records in "Pending" status.
    await createPendingRecords(id, amount, quantity);
    // Process pending order, payment and shipping records.
    await processPendingRecords(id, amount, quantity);
    res.json({ message: 'Order was created.', id });
  } catch (error) {
    log('error', error);
    res.status(500).json({ error, id });
  }
});

router.get('/check-order-status', async (req, res) => {
  try {
    log('/check-order-status', req.body);
    const { id } = req.body;
    const result = await data.query('SELECT * FROM order WHERE id = :id', { id });
    log('Result', result);
    return res.json({ status: result.status });
  } catch (error) {
    log('error', error);
    return res.status(500).json({ error });
  }
});

app.use('/monolith/', router);

module.exports = app;
