import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export type OsbMode = 'opensource' | 'aoss' | 'aos';

export interface OsbClientStackProps extends cdk.StackProps {
  mode: OsbMode;
  vpcId?: string;
  clusterSecurityGroupId?: string;
  instanceType?: string;
  clientName?: string;
  ebsVolumeSize?: number;
  /**
   * Optional S3 bucket the client may upload benchmark artifacts to.
   * Grants s3:PutObject on `arn:aws:s3:::<bucket>/<resultsPrefix>*` only.
   */
  resultsBucket?: string;
  /** Key prefix inside resultsBucket the client may write under. Default `runs/`. */
  resultsPrefix?: string;
  /**
   * Optional S3 bucket holding benchmark datasets. Grants read-only access:
   * s3:GetObject on its objects and s3:ListBucket on the bucket.
   */
  datasetsBucket?: string;
  /**
   * Where the instance goes: 'public' (a public subnet with a public IP; the default, as before) or
   * 'private' (a private subnet that reaches the internet through a NAT gateway, no public IP). An account
   * with VPC Block Public Access in block-ingress mode cuts the public path in both directions, so a client
   * there needs 'private'. 'private' requires a vpcId whose VPC has a private subnet with a NAT route.
   */
  subnetType?: 'public' | 'private';
}

/**
 * The shared network for clients that have no cluster VPC (aoss, aos): one VPC with a public subnet that
 * holds one NAT gateway and a private subnet for the clients, plus a free S3 gateway endpoint so dataset
 * downloads don't go through the NAT. One per account and region (OsbClientNetwork-<region>); every client
 * deploys into it with vpcId=<its VPC> and subnetType=private.
 */
export class OsbClientNetworkStack extends cdk.Stack {
  readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props: cdk.StackProps) {
    super(scope, id, props);
    this.vpc = new ec2.Vpc(this, 'OsbClientVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.40.0.0/16'),
      maxAzs: 1,
      natGateways: 1,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'private', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 20 },
      ],
      gatewayEndpoints: { S3: { service: ec2.GatewayVpcEndpointAwsService.S3 } },
    });
    new cdk.CfnOutput(this, 'VpcId', { value: this.vpc.vpcId });
  }
}

export class OpensearchBenchmarkClientSetupStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OsbClientStackProps) {
    super(scope, id, props);

    this.validateProps(props);

    const instanceType = new ec2.InstanceType(props.instanceType ?? 'c6g.4xlarge');
    const clientName = props.clientName ?? 'osb-client';
    const ebsSize = props.ebsVolumeSize ?? 100;

    // Use existing VPC or create a minimal one
    const vpc = props.vpcId
      ? ec2.Vpc.fromLookup(this, 'ClusterVpc', { vpcId: props.vpcId })
      : new ec2.Vpc(this, 'OsbVpc', { maxAzs: 1, natGateways: 0 });

    const osbSg = new ec2.SecurityGroup(this, 'OsbClientSg', {
      vpc,
      description: 'OSB client security group',
      allowAllOutbound: true,
    });

    const isArm = instanceType.architecture === ec2.InstanceArchitecture.ARM_64;
    const machineImage = ec2.MachineImage.latestAmazonLinux2023({
      cpuType: isArm ? ec2.AmazonLinuxCpuType.ARM_64 : ec2.AmazonLinuxCpuType.X86_64,
    });

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'set -xe',
      'yum update -y',
      'yum install python3.11 python3.11-pip python3.11-devel gcc-c++ tmux git -y',
      'pip3.11 install opensearch-benchmark pandas h5py',
      'opensearch-benchmark list workloads',
    );

    const instance = new ec2.Instance(this, 'OsbClientInstance', {
      vpc,
      vpcSubnets: { subnetType: props.subnetType === 'private' ? ec2.SubnetType.PRIVATE_WITH_EGRESS
                                                               : ec2.SubnetType.PUBLIC },
      associatePublicIpAddress: props.subnetType === 'private' ? false : undefined,
      instanceType,
      machineImage,
      securityGroup: osbSg,
      userData,
      blockDevices: [{
        deviceName: '/dev/xvda',
        volume: ec2.BlockDeviceVolume.ebs(ebsSize, { volumeType: ec2.EbsDeviceVolumeType.GP3 }),
      }],
      init: ec2.CloudFormationInit.fromElements(),
      initOptions: {
        timeout: cdk.Duration.minutes(15),
      },
    });
    instance.role.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')
    );
    cdk.Tags.of(instance).add('Name', clientName);

    // Mode-specific configuration
    switch (props.mode) {
      case 'opensource':
        const clusterSg = ec2.SecurityGroup.fromSecurityGroupId(
          this, 'ClusterSg', props.clusterSecurityGroupId!
        );
        clusterSg.addIngressRule(osbSg, ec2.Port.tcp(9200), 'OSB client access to OpenSearch');
        break;

      case 'aoss':
        instance.role.addToPrincipalPolicy(new iam.PolicyStatement({
          actions: ['aoss:APIAccessAll'],
          resources: ['*'],
        }));
        break;

      case 'aos':
        instance.role.addToPrincipalPolicy(new iam.PolicyStatement({
          actions: ['es:ESHttpGet', 'es:ESHttpPut', 'es:ESHttpPost', 'es:ESHttpHead', 'es:ESHttpDelete'],
          resources: ['*'],
        }));
        break;
    }

    if (props.resultsBucket) {
      const prefix = props.resultsPrefix ?? 'runs/';
      instance.role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['s3:PutObject'],
        resources: [`arn:aws:s3:::${props.resultsBucket}/${prefix}*`],
      }));
    }

    if (props.datasetsBucket) {
      instance.role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['s3:GetObject'],
        resources: [`arn:aws:s3:::${props.datasetsBucket}/*`],
      }));
      instance.role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [`arn:aws:s3:::${props.datasetsBucket}`],
      }));
    }

    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'PrivateIp', { value: instance.instancePrivateIp });
  }

  private validateProps(props: OsbClientStackProps): void {
    if (props.subnetType !== undefined && !['public', 'private'].includes(props.subnetType)) {
      throw new Error("subnetType must be 'public' or 'private'");
    }
    if (props.subnetType === 'private' && !props.vpcId) {
      // a VPC created per client has no NAT gateway (natGateways: 0): there is no private egress to land in
      throw new Error("subnetType 'private' requires vpcId (a VPC with a NAT route, e.g. OsbClientNetwork-<region>)");
    }
    if (props.mode === 'opensource') {
      if (!props.vpcId) {
        throw new Error("mode 'opensource' requires vpcId");
      }
      if (!props.clusterSecurityGroupId) {
        throw new Error("mode 'opensource' requires clusterSecurityGroupId");
      }
    }
  }
}
