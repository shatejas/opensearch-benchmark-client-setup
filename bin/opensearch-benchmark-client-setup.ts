#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OpensearchBenchmarkClientSetupStack } from '../lib/opensearch-benchmark-client-setup-stack';

const app = new cdk.App();

new OpensearchBenchmarkClientSetupStack(app, 'OsbClientStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcId: app.node.tryGetContext('vpcId'),
  clusterSecurityGroupId: app.node.tryGetContext('clusterSecurityGroupId'),
  instanceType: app.node.tryGetContext('instanceType'),
  clientName: app.node.tryGetContext('clientName'),
  ebsVolumeSize: app.node.tryGetContext('ebsVolumeSize')
    ? Number(app.node.tryGetContext('ebsVolumeSize'))
    : undefined,
});
