export {};
import * as AWS from 'aws-sdk';
import * as util from 'util';
// const AWS = require('aws-sdk');
// const rds = new AWS.RDSDataService({ region: process.env.AWS_REGION || 'us-east-1' });
// const params = {
//   resourceArn: process.env.ResourceArn,
//   secretArn: process.env.SecretArn,
//   database: 'shop',
//   sql: 'SELECT * FROM report;',
// };
// const response = await rds.executeStatement(params).promise();

function log(message: string, item: any) {
  console.log(`${message}:\n ${util.inspect(item, { showHidden: false, depth: null })}`);
}

const data = require('data-api-client')({
  resourceArn: process.env.RESOURCE_ARN,
  secretArn: process.env.SECRET_ARN,
  database: 'shop',
});

const dynamodb = new AWS.DynamoDB.DocumentClient({ region: process.env.AWS_REGION || 'us-east-1' });

const itemTable = process.env.ITEM_TABLE || 'ServerlessSeriesPart2Item';

const store: any = {};

exports.handler = async (event: any, context: any) => {
  // console.log(`Event:\n ${JSON.stringify(event, null, 2)}`);
  // console.log(`Context:\n ${JSON.stringify(context, null, 2)}`);
  try {
    const records = event.Records.filter((r: any) => r.eventName === 'INSERT');
    const items = records.reduce((items: any, record: any) => {
      const { ItemPK, Status } = record.dynamodb.NewImage;
      const item = ItemPK.S;
      const status = Status.S;
      items[item] = items[item] || { item, pending: 0, processed: 0, total: 0 };
      if (status === 'Pending') {
        items[item].pending++;
        items[item].total++;
      } else if (status === 'Processed') {
        items[item].processed++;
        items[item].pending--;
      }
      return items;
    }, {});
    log('Data', items);
    const keys = Object.entries(items).map(([key, value]) => key);
    log('Keys', keys);
    // TODO: Update when arrayValue is implemented, https://github.com/aws/aws-sdk-js/issues/2993
    let result = await data.query(`SELECT * FROM report WHERE item IN ('${keys.join("', '")}')`);
    log('Result', result);
    // Update the existing rows
    const updates = result.records.map((record: any) => {
      const item = items[record.item];
      delete items[record.item];
      const pending = record.pending + item.pending;
      const processed = record.processed + item.processed;
      const total = pending + processed;
      return [{ item: item.item, pending, processed, total }];
    });
    log('Updates', updates);
    // result = await data.query(
    //   'UPDATE report SET pending = :pending, processed = :processed ,total = :total WHERE item = :item',
    //   updates
    // );
    // log('Result -> Update', result);
    // Insert the new rows
    const inserts = [];
    for (let [key, value] of Object.entries(items)) {
      result = await dynamodb.get({ TableName: itemTable, Key: { PK: key } }).promise();
      store[key] = result.Item?.Title;
      (<any>value).title = result.Item?.Title || key;
      inserts.push([value]);
    }
    log('Inserts', inserts);
    // result = await data.query(
    //   'INSERT INTO report (item, title, pending, processed, total) VALUES(:item, :title, :pending, :processed, :total)',
    //   inserts
    // );
    // log('Result -> Insert', result);
    const transaction = data.transaction();
    if (updates.length > 0) {
      transaction.query(
        `UPDATE report
         SET pending = :pending, processed = :processed ,total = :total
         WHERE item = :item`,
        updates
      );
    }
    if (inserts.length > 0) {
      transaction.query(
        `INSERT 
         INTO report (item, title, pending, processed, total)
         VALUES(:item, :title, :pending, :processed, :total)`,
        inserts
      );
    }
    let results = await transaction.commit();
    log('Results', results);
    return;
  } catch (error) {
    console.log(`Error: ${error.message}`);
    return error;
  }
};
