import * as awsServerlessExpress from 'aws-serverless-express';
import * as app from './app';

const server = awsServerlessExpress.createServer(<any>app);

exports.handler = (event: any, context: any) => {
  awsServerlessExpress.proxy(server, event, context);
};
