#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OpensearchBenchmarkClientSetupStack, OsbMode } from '../lib/opensearch-benchmark-client-setup-stack';

const app = new cdk.App();

const region = app.node.tryGetContext('region') ?? process.env.CDK_DEFAULT_REGION;
const account = process.env.CDK_DEFAULT_ACCOUNT;
const clientName = app.node.tryGetContext('clientName') ?? 'osb-client';
const mode = app.node.tryGetContext('mode') as OsbMode;
// Optional: lets several clients coexist in one account/region
// (stack name OsbClientStack-<region>-<stackSuffix>). Omit for the original name.
const stackSuffix = app.node.tryGetContext('stackSuffix');

if (!mode || !['opensource', 'aoss', 'aos'].includes(mode)) {
  throw new Error("Required context: -c mode=opensource|aoss|aos");
}
if (stackSuffix !== undefined && !/^[A-Za-z0-9-]{1,64}$/.test(String(stackSuffix))) {
  throw new Error('stackSuffix must be 1-64 characters of letters, digits and hyphens');
}

const stackName = stackSuffix ? `OsbClientStack-${region}-${stackSuffix}` : `OsbClientStack-${region}`;

new OpensearchBenchmarkClientSetupStack(app, stackName, {
  env: { account, region },
  mode,
  vpcId: app.node.tryGetContext('vpcId'),
  clusterSecurityGroupId: app.node.tryGetContext('clusterSecurityGroupId'),
  instanceType: app.node.tryGetContext('instanceType'),
  clientName,
  ebsVolumeSize: app.node.tryGetContext('ebsVolumeSize')
    ? Number(app.node.tryGetContext('ebsVolumeSize'))
    : undefined,
  resultsBucket: app.node.tryGetContext('resultsBucket'),
  resultsPrefix: app.node.tryGetContext('resultsPrefix'),
  datasetsBucket: app.node.tryGetContext('datasetsBucket'),
});
