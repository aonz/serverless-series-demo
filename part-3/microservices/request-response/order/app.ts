import * as awsServerlessExpressMiddleware from 'aws-serverless-express/middleware';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import got from 'got';
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'order',
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
  await data.query('INSERT INTO `order` (id, `status`) VALUES(:id, :status)', {
    id,
    status: 'Pending',
  });
  const payment = got.post(`${process.env.PAYMENT_URL}/create-payment`, {
    json: { id, amount },
    responseType: 'json',
  });
  const shipping = got.post(`${process.env.SHIPPING_URL}/create-shipping`, {
    json: { id, quantity },
    responseType: 'json',
  });
  const results = await Promise.allSettled([payment, shipping]);
  log('results', results);
  // How to deal with error(s)?
  console.log('Finish - Create pending records');
}

async function processPendingRecords(id: string, amount: number, quantity: number) {
  try {
    console.log('Start - Process pending records');
    // Process payment
    const payment = got.post(`${process.env.PAYMENT_URL}/process-payment`, {
      json: { id, amount },
      responseType: 'json',
    });
    // Process shipping.
    const shipping = got.post(`${process.env.SHIPPING_URL}/process-shipping`, {
      json: { id, quantity },
      responseType: 'json',
    });
    const results = await Promise.allSettled([payment, shipping]);
    log('results', results);
    // Reconcile records.
    if (!!(<any>results[0]).value.body.error) {
      results[0].status = 'rejected';
    }
    if (!!(<any>results[1]).value.body.error) {
      results[1].status = 'rejected';
    }
    await reconcileRecords(id, results[0].status, results[1].status);
    console.log('Finish - Process pending records');
  } catch (error) {
    log('Error - Process pending records', error);
    throw error;
  }
}

async function reconcileRecords(id: string, paymentStatus: string, shippingStatus: string) {
  let status = 'Processed';
  let payment = new Promise((resolve) => resolve());
  let shipping = new Promise((resolve) => resolve());
  if (paymentStatus === 'rejected' || shippingStatus === 'rejected') {
    status = 'OnHold';
    if (paymentStatus === 'rejected' && shippingStatus === 'fulfilled') {
      // Reconcile shipping record.
      shipping = got.post(`${process.env.SHIPPING_URL}/reconcile-shipping`, {
        json: { id },
        responseType: 'json',
      });
    }
    if (paymentStatus === 'fulfilled' && shippingStatus === 'rejected') {
      // Reconcile payment record.
      payment = got.post(`${process.env.PAYMENT_URL}/reconcile-payment`, {
        json: { id },
        responseType: 'json',
      });
    }
  }
  const results = await Promise.allSettled([payment, shipping]);
  log('results', results);
  // How to deal with error(s)?
  await new Promise((resolve) => setTimeout(resolve, 3000));
  // Update order's status to "Processed" of "OnHold".
  await data.query('UPDATE `order` SET `status` = :status WHERE id = :id', { id, status });
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

app.use('/microservices/request-response/order/', router);

module.exports = app;
