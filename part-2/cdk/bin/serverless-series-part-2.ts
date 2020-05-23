#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { ServerlessSeriesPart2Stack } from '../lib/serverless-series-part-2-stack';

const app = new cdk.App();
new ServerlessSeriesPart2Stack(app, 'ServerlessSeriesPart2Stack', {
  env: { region: process.env.AWS_REGION || 'us-east-1' },
});
