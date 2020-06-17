import * as awsServerlessExpressMiddleware from 'aws-serverless-express/middleware';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as util from 'util';
import { v4 as uuidv4 } from 'uuid';

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'payment',
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

router.post('/create-payment', async (req, res) => {
  log('/create-payment', req.body);
  const { id, amount } = req.body;
  try {
    await data.query('INSERT INTO payment (id, `status`, amount) VALUES(:id, :status, :amount)', {
      id,
      status: 'Pending',
      amount,
    });
    res.json({ message: 'Payment was created.', id });
  } catch (error) {
    log('error', error);
    res.status(500).json({ error, id });
  }
});

router.post('/make-payment', async (req, res) => {
  log('/make-payment', req.body);
  const { id, amount } = req.body;
  try {
    const status = amount <= 1000 ? 'Processed' : 'Exceeded';
    await data.query('UPDATE payment SET `status` = :status WHERE id = :id', { id, status });
    if (status === 'Exceeded') {
      const error = new Error('Exceeds payment amount limit.');
      log('Error - Make payment', error);
      return res.json({ error: error.message, id });
    }
    return res.json({ message: 'Payment was processed.', id });
  } catch (error) {
    log('error', error);
    return res.status(500).json({ error, id });
  }
});

router.post('/reconcile-payment', async (req, res) => {
  log('/reconcile-payment', req.body);
  const { id } = req.body;
  try {
    await data.query('UPDATE payment SET `status` = :status WHERE id = :id', {
      id,
      status: 'OnHold',
    });
    return res.json({ message: 'Payment was reconciled.', id });
  } catch (error) {
    log('error', error);
    return res.status(500).json({ error, id });
  }
});

app.use('/payment/', router);

module.exports = app;
