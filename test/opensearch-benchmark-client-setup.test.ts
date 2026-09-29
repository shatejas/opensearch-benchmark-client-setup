import * as cdk from 'aws-cdk-lib/core';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { OpensearchBenchmarkClientSetupStack } from '../lib/opensearch-benchmark-client-setup-stack';

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

test('aoss mode still grants aoss:APIAccessAll', () => {
  synth().hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([Match.objectLike({ Action: 'aoss:APIAccessAll' })]),
    },
  });
});
