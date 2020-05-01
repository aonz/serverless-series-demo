const awsServerlessExpress = require('aws-serverless-express');
const express = require('express');
const router = require('./router');

const app = express();
app.use('/express', router);
const server = awsServerlessExpress.createServer(app);

exports.lambdaHandler = (event, context) => awsServerlessExpress.proxy(server, event, context);
