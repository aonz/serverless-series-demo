import * as awsServerlessExpressMiddleware from 'aws-serverless-express/middleware';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as util from 'util';

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN || '',
  secretArn: process.env.SECRET_ARN || '',
  database: 'shipping',
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

router.post('/create-shipping', async (req, res) => {
  log('/create-shipping', req.body);
  const { id, quantity } = req.body;
  try {
    await data.query(
      'INSERT INTO shipping (id, `status`, quantity) VALUES(:id, :status, :quantity)',
      {
        id,
        status: 'Pending',
        quantity,
      }
    );
    res.json({ message: 'Shipping was created.', id });
  } catch (error) {
    log('error', error);
    res.status(500).json({ error, id });
  }
});

router.post('/process-shipping', async (req, res) => {
  log('/process-shipping', req.body);
  const { id, quantity } = req.body;
  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const status = quantity <= 100 ? 'Processed' : 'Exceeded';
    await data.query('UPDATE shipping SET `status` = :status WHERE id = :id', { id, status });
    if (status === 'Exceeded') {
      const error = new Error('Exceeds shipping quantity limit.');
      log('Error - Make shipping', error);
      return res.json({ error: error.message, id });
    }
    return res.json({ message: 'Shipping was processed.', id });
  } catch (error) {
    log('error', error);
    return res.status(500).json({ error, id });
  }
});

router.post('/reconcile-shipping', async (req, res) => {
  log('/reconcile-shipping', req.body);
  const { id } = req.body;
  try {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    await data.query('UPDATE shipping SET `status` = :status WHERE id = :id', {
      id,
      status: 'OnHold',
    });
    return res.json({ message: 'Shipping was reconciled.', id });
  } catch (error) {
    log('error', error);
    return res.status(500).json({ error, id });
  }
});

app.use('/shipping/', router);

module.exports = app;
