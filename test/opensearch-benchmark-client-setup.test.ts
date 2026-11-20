import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { OpensearchBenchmarkClientSetupStack, OsbClientNetworkStack } from '../lib/opensearch-benchmark-client-setup-stack';

const env = { account: '111111111111', region: 'us-east-1' };

function synth(extra: Record<string, unknown> = {}): Template {
  const app = new cdk.App();
  const stack = new OpensearchBenchmarkClientSetupStack(app, 'TestStack', {
    env,
    mode: 'aoss',
    ...extra,
  });
  return Template.fromStack(stack);
}

function putObjectStatements(template: Template): any[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .flatMap((p: any) => p.Properties.PolicyDocument.Statement)
    .filter((s: any) => s.Action === 's3:PutObject');
}

test('no S3 grant without resultsBucket (existing behaviour)', () => {
  expect(putObjectStatements(synth())).toHaveLength(0);
});

test('resultsBucket grants PutObject on the default runs/ prefix only', () => {
  const statements = putObjectStatements(synth({ resultsBucket: 'my-results' }));
  expect(statements).toHaveLength(1);
  expect(statements[0].Resource).toBe('arn:aws:s3:::my-results/runs/*');
  expect(statements[0].Effect).toBe('Allow');
});

test('resultsPrefix narrows the grant', () => {
  const statements = putObjectStatements(
    synth({ resultsBucket: 'my-results', resultsPrefix: 'runs/r-123/' }),
  );
  expect(statements[0].Resource).toBe('arn:aws:s3:::my-results/runs/r-123/*');
});

function statementsFor(template: Template, action: string): any[] {
  const policies = template.findResources('AWS::IAM::Policy');
  return Object.values(policies)
    .flatMap((p: any) => p.Properties.PolicyDocument.Statement)
    .filter((s: any) => s.Action === action);
}

test('no dataset grant without datasetsBucket', () => {
  const t = synth();
  expect(statementsFor(t, 's3:GetObject')).toHaveLength(0);
  expect(statementsFor(t, 's3:ListBucket')).toHaveLength(0);
});

test('datasetsBucket grants read-only access to that bucket', () => {
  const t = synth({ datasetsBucket: 'my-datasets' });
  const get = statementsFor(t, 's3:GetObject');
  const list = statementsFor(t, 's3:ListBucket');
  expect(get).toHaveLength(1);
  expect(get[0].Resource).toBe('arn:aws:s3:::my-datasets/*');
  expect(list).toHaveLength(1);
  expect(list[0].Resource).toBe('arn:aws:s3:::my-datasets');
  expect(putObjectStatements(t)).toHaveLength(0);
});

test('aoss mode still grants aoss:APIAccessAll', () => {
  synth().hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([Match.objectLike({ Action: 'aoss:APIAccessAll' })]),
    },
  });
});

function instanceProps(template: Template): any {
  return Object.values(template.findResources('AWS::EC2::Instance'))[0].Properties;
}

test('public is the default: the instance keeps its public subnet (existing behaviour)', () => {
  const t = synth();
  expect(instanceProps(t).NetworkInterfaces).toBeUndefined();
});

test('subnetType private puts the instance in a private subnet with no public IP', () => {
  const t = synth({ vpcId: 'vpc-123', subnetType: 'private' });
  const ni = instanceProps(t).NetworkInterfaces;
  expect(ni).toHaveLength(1);
  expect(ni[0].AssociatePublicIpAddress).toBe(false);
  // the lookup's dummy VPC names its private subnets p-12345 / p-67890 and its public ones s-12345 / s-67890
  expect(String(ni[0].SubnetId)).toMatch(/^p-/);
});

test('subnetType private without vpcId is refused (no NAT to egress through)', () => {
  expect(() => synth({ subnetType: 'private' })).toThrow(/requires vpcId/);
});

test('an unknown subnetType is refused', () => {
  expect(() => synth({ vpcId: 'vpc-123', subnetType: 'isolated' as any })).toThrow(/public' or 'private/);
});

test('the client network: one NAT gateway, a private subnet, an S3 gateway endpoint, the VPC id output', () => {
  const app = new cdk.App();
  const t = Template.fromStack(new OsbClientNetworkStack(app, 'Net', { env }));
  t.resourceCountIs('AWS::EC2::VPC', 1);
  t.resourceCountIs('AWS::EC2::NatGateway', 1);
  t.resourceCountIs('AWS::EC2::Subnet', 2);
  t.hasResourceProperties('AWS::EC2::Subnet', { MapPublicIpOnLaunch: false });
  t.hasResourceProperties('AWS::EC2::VPCEndpoint', { VpcEndpointType: 'Gateway' });
  t.hasOutput('VpcId', {});
});
