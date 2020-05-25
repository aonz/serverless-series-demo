import * as awsServerlessExpress from 'aws-serverless-express';
import * as app from './app';

const server = awsServerlessExpress.createServer(<any>app);

exports.handler = (event: any, context: any) => {
  // console.log(`Event:\n ${JSON.stringify(event, null, 2)}`);
  // console.log(`Context:\n ${JSON.stringify(context, null, 2)}`);
  awsServerlessExpress.proxy(server, event, context);
};
