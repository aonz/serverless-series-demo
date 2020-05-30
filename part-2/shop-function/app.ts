import * as AWS from 'aws-sdk';
import * as awsServerlessExpressMiddleware from 'aws-serverless-express/middleware';
import * as bodyParser from 'body-parser';
import * as cors from 'cors';
import * as express from 'express';
import * as util from 'util';

const app = express();
const router = express.Router();

router.use(cors());
router.use(bodyParser.json());
router.use(bodyParser.urlencoded({ extended: true }));
router.use(awsServerlessExpressMiddleware.eventContext());

const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'ap-southeast-1',
});

const shopTable = process.env.SHOP_TABLE || 'ServerlessSeriesPart2Shop';
const itemTable = process.env.ITEM_TABLE || 'ServerlessSeriesPart2Item';

function log(message: string, item: any) {
  console.log(`${message}:\n ${util.inspect(item, { showHidden: false, depth: null })}`);
}

router.get('/health', (req, res) => {
  res.json({ message: 'Ok' });
});

router.post('/register-user', async (req, res) => {
  console.log('POST: /register-user');
  const { body } = req;
  log('Body', body);
  try {
    const { profile, address } = body;
    const { username, name } = profile;
    const { city, country } = address;
    const params: any = {
      RequestItems: {
        [shopTable]: [
          { PutRequest: { Item: { PK: username, SK: 'Profile', Name: name } } }, // Profile
          { PutRequest: { Item: { PK: username, SK: 'Address', City: city, Country: country } } }, // Address
        ],
      },
    };
    const result = await dynamodb.batchWrite(params).promise();
    log('Result', result);
    return res.status(201).json({ message: 'User created.' });
  } catch (error) {
    log('Error', error);
    return res.status(400).json({ error: error.message });
  }
});

router.post('/create-order', async (req, res) => {
  console.log('POST: /create-order');
  const { body } = req;
  log('Body', body);
  try {
    // Atomic Counter
    let result: any = await dynamodb
      .update({
        TableName: shopTable,
        Key: { PK: '_order', SK: '_order' },
        UpdateExpression: 'set #v = #v + :v',
        ExpressionAttributeNames: { '#v': 'Value' },
        ExpressionAttributeValues: { ':v': 1 },
        ReturnValues: 'UPDATED_NEW',
      })
      .promise();
    const order: number = parseInt(result.Attributes.Value) || 1;
    const { username, items } = body;
    const date = new Date().toISOString().split('T')[0];
    // Order Items
    const requestItems = items.map((i: string) => {
      return {
        PutRequest: {
          Item: {
            PK: username,
            SK: `Order-${order}#${i}#Pending#${date}`,
            Order: `Order-${order}`,
            ItemPK: i,
            Status: 'Pending',
            Date: date,
            GSI1PK: 'Item#Pending',
            GSI1SK: `${i}#Order-${order}`,
          },
        },
      };
    });
    // Order Summary
    requestItems.push({
      PutRequest: {
        Item: { PK: username, SK: `Order-${order}#Summary`, Total: `${items.length}` },
      },
    });
    const params: any = { RequestItems: { [shopTable]: requestItems } };
    result = await dynamodb.batchWrite(params).promise();
    log('Result', result);
    return res.json({ message: `Order 'Order-${order}' created.` });
  } catch (error) {
    log('Error', error);
    return res.status(400).json({ error: error.message });
  }
});

router.post('/get-order-summary', async (req, res) => {
  console.log('POST: /get-order-summary');
  const { body } = req;
  log('Body', body);
  try {
    const { username, order } = body;
    const params: any = {
      RequestItems: {
        [shopTable]: {
          Keys: [
            { PK: username, SK: 'Profile' },
            { PK: username, SK: 'Address' },
            { PK: username, SK: `${order}#Summary` },
          ],
        },
      },
    };
    const result: any = await dynamodb.batchGet(params).promise();
    log('Result', result);
    const profile = result.Responses[shopTable].find((i: any) => i.SK === 'Profile');
    const address = result.Responses[shopTable].find((i: any) => i.SK === 'Address');
    const summary = result.Responses[shopTable].find((i: any) => i.SK === `${order}#Summary`);
    return res.json({
      name: profile.Name,
      city: address.City,
      country: address.Country,
      total: summary.Total,
      status: summary.status || 'In Progress',
    });
  } catch (error) {
    log('Error', error);
    return res.status(400).json({ error: error.message });
  }
});

const store: any = {};

router.post('/get-order-item-status', async (req, res) => {
  console.log('POST: /get-order-item-status');
  const { body } = req;
  log('Body', body);
  try {
    const { username, order } = body;
    const params: any = {
      TableName: shopTable,
      KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
      ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
      ExpressionAttributeValues: { ':pk': username, ':sk': `${order}#Item` },
    };
    let result: any = await dynamodb.query(params).promise();
    log('Result', result);
    const items = await Promise.all(
      result.Items.map(async (item: any) => {
        const itemPK = item.ItemPK;
        let itemTitle = store[itemPK];
        if (!itemTitle) {
          console.log(`Fetch item: '${itemPK}' ...`);
          result = await dynamodb.get({ TableName: itemTable, Key: { PK: itemPK } }).promise();
          store[itemPK] = result.Item?.Title;
          itemTitle = result.Item?.Title || itemPK;
        }
        return { item: itemTitle, status: item.Status, date: item.Date };
      })
    );
    return res.json({ items });
  } catch (error) {
    log('Error', error);
    return res.status(400).json({ error: error.message });
  }
});

router.post('/process-item', async (req, res) => {
  console.log('POST: /process-item');
  const { body } = req;
  log('Body', body);
  try {
    const { username, order, item } = body;
    let result: any = await dynamodb
      .query({
        TableName: shopTable,
        KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
        ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK' },
        ExpressionAttributeValues: { ':pk': username, ':sk': `${order}#${item}` },
      })
      .promise();
    const oldItem: any = result.Items[0];
    log('oldItem', oldItem);
    if (oldItem.Status === 'Processed') {
      return res.status(400).json({ error: 'Already processed.' });
    }
    const date = new Date().toISOString().split('T')[0];
    const newItem = {
      ...oldItem,
      SK: `${order}#${item}#Processed#${date}`,
      Status: 'Processed',
      GSI1PK: 'Item#Processed',
    };
    const { PK, SK } = oldItem;
    const items: any = [
      { Put: { TableName: shopTable, Item: newItem } },
      { Delete: { TableName: shopTable, Key: { PK, SK } } },
    ];
    result = await await dynamodb
      .query({
        TableName: shopTable,
        KeyConditionExpression: '#pk = :pk and begins_with(#sk, :sk)',
        FilterExpression: '#status = :status',
        ExpressionAttributeNames: { '#pk': 'PK', '#sk': 'SK', '#status': 'Status' },
        ExpressionAttributeValues: {
          ':pk': username,
          ':sk': `${order}#Item`,
          ':status': 'Pending',
        },
        ProjectionExpression: 'SK',
      })
      .promise();
    log('result', result);
    if (result.Count === 1) {
      console.log('Mark order as completed...');
      items.push({
        Update: {
          TableName: shopTable,
          Key: { PK, SK: `${order}#Summary` },
          UpdateExpression: 'set GSI1PK = :gsi1pk, GSI1SK = :gsi1sk',
          ExpressionAttributeValues: {
            ':gsi1pk': 'Order#Completed',
            ':gsi1sk': `${username}#${order}`,
          },
        },
      });
    }
    const params: any = { TransactItems: items };
    result = await dynamodb.transactWrite(params).promise();
    log('Result', result);
    return res.json({ message: 'Item processed.' });
  } catch (error) {
    log('Error', error);
    return res.status(400).json({ error: error.message });
  }
});

router.post('/get-pending-items', async (req, res) => {
  console.log('POST: /get-pending-items');
  const { body } = req;
  log('Body', body);
  try {
    const params: any = {
      TableName: shopTable,
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :gsi1pk',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
      ExpressionAttributeValues: { ':gsi1pk': 'Item#Pending' },
      ProjectionExpression: 'SK',
    };
    let result: any = await dynamodb.query(params).promise();
    log('Result', result);
    const items = result.Items.map((i: any) => {
      return { item: i.SK.split('#')[1], order: i.SK.split('#')[0] };
    });
    const summary = items.reduce((a: any, v: any) => {
      a[v.item] = a[v.item] ? a[v.item] + 1 : 1;
      return a;
    }, {});
    return res.json({ summary, items });
  } catch (error) {
    log('Error', error);
    return res.status(400).json({ error: error.message });
  }
});

router.post('/get-completed-orders', async (req, res) => {
  console.log('POST: /get-completed-orders');
  const { body } = req;
  log('Body', body);
  try {
    const params: any = {
      TableName: shopTable,
      IndexName: 'GSI1',
      KeyConditionExpression: '#gsi1pk = :gsi1pk',
      ExpressionAttributeNames: { '#gsi1pk': 'GSI1PK' },
      ExpressionAttributeValues: { ':gsi1pk': 'Order#Completed' },
      ProjectionExpression: 'SK',
    };
    let result: any = await dynamodb.query(params).promise();
    log('Result', result);
    return res.json({ items: result.Items.map((i: any) => i.SK.split('#')[0]) });
  } catch (error) {
    log('Error', error);
    return res.status(400).json({ error: error.message });
  }
});

app.use('/', router);

module.exports = app;
