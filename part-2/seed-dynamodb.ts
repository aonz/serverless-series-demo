import * as AWS from 'aws-sdk';
import * as util from 'util';

const dynamodb = new AWS.DynamoDB({ region: process.env.AWS_REGION || 'us-east-1' });

const shopTable = process.env.SHOP_TABLE || 'ServerlessSeriesPart2Shop';
const itemTable = process.env.ITEM_TABLE || 'ServerlessSeriesPart2Item';

async function seed() {
  const params: any = {
    RequestItems: {
      [shopTable]: [
        { PutRequest: { Item: { PK: { S: '_order' }, SK: { S: '_order' }, Value: { N: '0' } } } },
      ],
      [itemTable]: [
        { PutRequest: { Item: { PK: { S: 'Item-1' }, Title: { S: 'Item 1' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-2' }, Title: { S: 'Item 2' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-3' }, Title: { S: 'Item 3' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-4' }, Title: { S: 'Item 4' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-5' }, Title: { S: 'Item 5' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-6' }, Title: { S: 'Item 6' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-7' }, Title: { S: 'Item 7' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-8' }, Title: { S: 'Item 8' } } } },
        { PutRequest: { Item: { PK: { S: 'Item-9' }, Title: { S: 'Item 9' } } } },
      ],
    },
  };
  const result = await dynamodb.batchWriteItem(params).promise();
  console.log(`Result:\n ${util.inspect(result, { showHidden: false, depth: null })}`);
}
seed();
