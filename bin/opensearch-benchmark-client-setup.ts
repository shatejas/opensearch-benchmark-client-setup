#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OpensearchBenchmarkClientSetupStack, OsbMode } from '../lib/opensearch-benchmark-client-setup-stack';

const app = new cdk.App();

const region = app.node.tryGetContext('region') ?? process.env.CDK_DEFAULT_REGION;
const account = process.env.CDK_DEFAULT_ACCOUNT;
const clientName = app.node.tryGetContext('clientName') ?? 'osb-client';
const mode = app.node.tryGetContext('mode') as OsbMode;

if (!mode || !['opensource', 'aoss', 'aos'].includes(mode)) {
  throw new Error("Required context: -c mode=opensource|aoss|aos");
}

new OpensearchBenchmarkClientSetupStack(app, `OsbClientStack-${region}`, {
  env: { account, region },
  mode,
  vpcId: app.node.tryGetContext('vpcId'),
  clusterSecurityGroupId: app.node.tryGetContext('clusterSecurityGroupId'),
  instanceType: app.node.tryGetContext('instanceType'),
  clientName,
  ebsVolumeSize: app.node.tryGetContext('ebsVolumeSize')
    ? Number(app.node.tryGetContext('ebsVolumeSize'))
    : undefined,
});
