#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { ServerlessSeriesPart3Stack } from '../lib/serverless-series-part-3-stack';

const app = new cdk.App();
new ServerlessSeriesPart3Stack(app, 'ServerlessSeriesPart3Stack');
