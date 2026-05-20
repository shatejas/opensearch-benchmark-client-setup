import * as cdk from 'aws-cdk-lib/core';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Construct } from 'constructs';

export interface OsbClientStackProps extends cdk.StackProps {
  vpcId?: string;
  clusterSecurityGroupId?: string;
  instanceType?: string;
  clientName?: string;
  ebsVolumeSize?: number;
}

export class OpensearchBenchmarkClientSetupStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: OsbClientStackProps) {
    super(scope, id, props);

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

    // If cluster SG provided, allow OSB client to reach it on port 9200
    if (props.clusterSecurityGroupId) {
      const clusterSg = ec2.SecurityGroup.fromSecurityGroupId(
        this, 'ClusterSg', props.clusterSecurityGroupId
      );
      clusterSg.addIngressRule(osbSg, ec2.Port.tcp(9200), 'OSB client access to OpenSearch');
    }

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
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
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

    new cdk.CfnOutput(this, 'InstanceId', { value: instance.instanceId });
    new cdk.CfnOutput(this, 'PrivateIp', { value: instance.instancePrivateIp });
  }
}
