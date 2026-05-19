#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import { OpensearchBenchmarkClientSetupStack } from '../lib/opensearch-benchmark-client-setup-stack';

const app = new cdk.App();

const vpcId = app.node.tryGetContext('vpcId');
const clusterSecurityGroupId = app.node.tryGetContext('clusterSecurityGroupId');

if (!vpcId || !clusterSecurityGroupId) {
  throw new Error('Required context: -c vpcId=<vpc-id> -c clusterSecurityGroupId=<sg-id>');
}

new OpensearchBenchmarkClientSetupStack(app, 'OsbClientStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcId,
  clusterSecurityGroupId,
  instanceType: app.node.tryGetContext('instanceType'),
  clientName: app.node.tryGetContext('clientName'),
  ebsVolumeSize: app.node.tryGetContext('ebsVolumeSize')
    ? Number(app.node.tryGetContext('ebsVolumeSize'))
    : undefined,
});
