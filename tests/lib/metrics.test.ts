/* eslint-disable @typescript-eslint/no-explicit-any */
import { Action, MetricTypes, StandardUnit } from '~/interface';
import { SessionProxy } from '~/proxy';
import {
    DimensionRecord,
    formatDimensions,
    MetricsPublisher,
    MetricsPublisherProxy,
} from '~/metrics';
import { CloudWatch } from '@aws-sdk/client-cloudwatch';
import { MockAWSError } from '../utils';

const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output),
    });
};

jest.mock('@aws-sdk/client-cloudwatch');

describe('when getting metrics', () => {
    const MOCK_DATE = new Date('2020-01-01T23:05:38.964Z');
    const RESOURCE_TYPE = 'Aa::Bb::Cc';
    const NAMESPACE = 'AWS/CloudFormation/Aa/Bb/Cc';
    const AWS_CONFIG = {
        region: 'us-east-1',
        credentials: async () => ({
            accessKeyId: 'AAAAA',
            secretAccessKey: '11111',
        }),
    };

    let session: SessionProxy;
    let proxy: MetricsPublisherProxy;
    let publisher: MetricsPublisher;
    let cloudwatch: jest.Mock<Partial<CloudWatch>>;
    let putMetricData: jest.Mock;

    beforeAll(() => {
        session = new SessionProxy(AWS_CONFIG);
    });

    beforeEach(() => {
        putMetricData = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        cloudwatch = (CloudWatch as unknown) as jest.Mock;
        cloudwatch.mockImplementation((config = {}) => {
            const returnValue: jest.Mocked<Partial<CloudWatch>> = {
                putMetricData,
            };
            const ctor = CloudWatch;
            ctor['serviceIdentifier'] = 'cloudwatch';
            return {
                ...returnValue,
                config: { ...AWS_CONFIG, ...config, update: () => undefined },
                constructor: ctor,
                putMetricData,
            };
        });
        proxy = new MetricsPublisherProxy();
        publisher = new MetricsPublisher(session, console, RESOURCE_TYPE);
        proxy.addMetricsPublisher(publisher);
        publisher.refreshClient();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('format dimensions', () => {
        const dimensions: DimensionRecord = {
            MyDimensionKeyOne: 'valOne',
            MyDimensionKeyTwo: 'valTwo',
        };
        const result = formatDimensions(dimensions);
        expect(result).toMatchObject([
            { Name: 'MyDimensionKeyOne', Value: 'valOne' },
            { Name: 'MyDimensionKeyTwo', Value: 'valTwo' },
        ]);
    });

    test('put metric catches error', async () => {
        const spyLogger: jest.SpyInstance = jest.spyOn(publisher['logger'], 'log');
        putMetricData.mockRejectedValueOnce(
            new MockAWSError({
                code: 'InternalServiceError',
                message:
                    'An error occurred (InternalServiceError) when ' +
                    'calling the PutMetricData operation: ',
                retryable: false,
            })
        );
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: Action.Create,
            DimensionKeyResourceType: RESOURCE_TYPE,
        };
        await publisher.publishMetric(
            MetricTypes.HandlerInvocationCount,
            dimensions,
            StandardUnit.Count,
            1.0,
            MOCK_DATE
        );
        expect(putMetricData).toHaveBeenCalledTimes(1);
        expect(putMetricData).toHaveBeenCalledWith({
            MetricData: [
                {
                    Dimensions: [
                        {
                            Name: 'DimensionKeyActionType',
                            Value: 'CREATE',
                        },
                        {
                            Name: 'DimensionKeyResourceType',
                            Value: 'Aa::Bb::Cc',
                        },
                    ],
                    MetricName: MetricTypes.HandlerInvocationCount,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
            Namespace: NAMESPACE,
        });
        expect(spyLogger).toHaveBeenCalledTimes(1);
        expect(spyLogger).toHaveBeenCalledWith(
            'An error occurred while ' +
                'publishing metrics: An error occurred (InternalServiceError) ' +
                'when calling the PutMetricData operation: '
        );
    });

    test('publish exception metric', async () => {
        await proxy.publishExceptionMetric(
            MOCK_DATE,
            Action.Create,
            new Error('fake-err')
        );
        expect(putMetricData).toHaveBeenCalledTimes(1);
        expect(putMetricData).toHaveBeenCalledWith({
            MetricData: [
                {
                    Dimensions: [
                        {
                            Name: 'DimensionKeyActionType',
                            Value: 'CREATE',
                        },
                        {
                            Name: 'DimensionKeyExceptionType',
                            Value: 'Error',
                        },
                        {
                            Name: 'DimensionKeyResourceType',
                            Value: 'Aa::Bb::Cc',
                        },
                    ],
                    MetricName: MetricTypes.HandlerException,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
            Namespace: NAMESPACE,
        });
    });

    test('publish invocation metric', async () => {
        await proxy.publishInvocationMetric(MOCK_DATE, Action.Create);
        expect(putMetricData).toHaveBeenCalledTimes(1);
        expect(putMetricData).toHaveBeenCalledWith({
            MetricData: [
                {
                    Dimensions: [
                        {
                            Name: 'DimensionKeyActionType',
                            Value: 'CREATE',
                        },
                        {
                            Name: 'DimensionKeyResourceType',
                            Value: 'Aa::Bb::Cc',
                        },
                    ],
                    MetricName: MetricTypes.HandlerInvocationCount,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
            Namespace: NAMESPACE,
        });
    });

    test('publish duration metric', async () => {
        await proxy.publishDurationMetric(MOCK_DATE, Action.Create, 100);
        expect(putMetricData).toHaveBeenCalledTimes(1);
        expect(putMetricData).toHaveBeenCalledWith({
            MetricData: [
                {
                    Dimensions: [
                        {
                            Name: 'DimensionKeyActionType',
                            Value: 'CREATE',
                        },
                        {
                            Name: 'DimensionKeyResourceType',
                            Value: 'Aa::Bb::Cc',
                        },
                    ],
                    MetricName: MetricTypes.HandlerInvocationDuration,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Milliseconds,
                    Value: 100,
                },
            ],
            Namespace: NAMESPACE,
        });
    });

    test('publish log delivery exception metric', async () => {
        await proxy.publishLogDeliveryExceptionMetric(MOCK_DATE, new TypeError('test'));
        expect(putMetricData).toHaveBeenCalledTimes(1);
        expect(putMetricData).toHaveBeenCalledWith({
            MetricData: [
                {
                    Dimensions: [
                        {
                            Name: 'DimensionKeyActionType',
                            Value: 'ProviderLogDelivery',
                        },
                        {
                            Name: 'DimensionKeyExceptionType',
                            Value: 'TypeError',
                        },
                        {
                            Name: 'DimensionKeyResourceType',
                            Value: 'Aa::Bb::Cc',
                        },
                    ],
                    MetricName: MetricTypes.HandlerException,
                    Timestamp: MOCK_DATE,
                    Unit: StandardUnit.Count,
                    Value: 1.0,
                },
            ],
            Namespace: NAMESPACE,
        });
    });

    test('publish log delivery exception metric with error', async () => {
        const spyLogger: jest.SpyInstance = jest.spyOn(publisher['logger'], 'log');
        const spyPublishLog: jest.SpyInstance = jest.spyOn(
            publisher,
            'publishLogDeliveryExceptionMetric'
        );
        const errorObject = {
            code: 'InternalServiceError',
            message: 'Sorry',
            retryable: true,
        };
        putMetricData.mockRejectedValueOnce(new MockAWSError(errorObject));
        await proxy.publishLogDeliveryExceptionMetric(MOCK_DATE, new TypeError('test'));
        expect(putMetricData).toHaveBeenCalledTimes(1);
        expect(putMetricData).toHaveBeenCalledWith({
            MetricData: expect.any(Array),
            Namespace: NAMESPACE,
        });
        expect(spyLogger).toHaveBeenCalledTimes(1);
        expect(spyLogger).toHaveBeenCalledWith(expect.objectContaining(errorObject));
        expect(spyPublishLog).toHaveReturned();
    });

    test('metrics publisher without refreshing client', async () => {
        expect.assertions(1);
        const metricsPublisher = new MetricsPublisher(session, console, RESOURCE_TYPE);
        try {
            await metricsPublisher.publishMetric(
                MetricTypes.HandlerInvocationCount,
                null,
                StandardUnit.Count,
                1.0,
                MOCK_DATE
            );
        } catch (e: any) {
            expect(e.message).toMatch(/CloudWatch client was not initialized/);
        }
    });

    test('metrics publisher proxy add metrics publisher null safe', () => {
        const proxy = new MetricsPublisherProxy();
        proxy.addMetricsPublisher(null);
        proxy.addMetricsPublisher(undefined);
        expect(proxy['publishers']).toMatchObject([]);
    });
});
