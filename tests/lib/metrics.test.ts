import CloudWatch from 'aws-sdk/clients/cloudwatch';
import awsUtil from 'aws-sdk/lib/util';

import { Action, MetricTypes, StandardUnit } from '../../src/interface';
import { SessionProxy } from '../../src/proxy';
import {
    DimensionRecord,
    MetricsPublisher,
    MetricsPublisherProxy,
    formatDimensions,
} from '../../src/metrics';

const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output),
    });
};

const MOCK_DATE = new Date('2020-01-01T23:05:38.964Z');
const RESOURCE_TYPE = 'Aa::Bb::Cc';
const NAMESPACE = MetricsPublisher.makeNamespace(RESOURCE_TYPE);

jest.mock('aws-sdk/clients/cloudwatch');

describe('when getting metrics', () => {
    let session: SessionProxy;
    let proxy: MetricsPublisherProxy;
    let publisher: MetricsPublisher;
    let cloudwatch: jest.Mock;
    let putMetricData: jest.Mock;

    beforeAll(() => {
        session = new SessionProxy({});
        putMetricData = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        cloudwatch = (CloudWatch as unknown) as jest.Mock;
        cloudwatch.mockImplementation(() => {
            const returnValue = {
                putMetricData,
            };
            return {
                ...returnValue,
                makeRequest: (operation: string, params?: { [key: string]: any }) => {
                    return returnValue[operation](params);
                },
            };
        });
        session['client'] = cloudwatch;
    });

    beforeEach(() => {
        proxy = new MetricsPublisherProxy();
        publisher = new MetricsPublisher(session, console, RESOURCE_TYPE);
        proxy.addMetricsPublisher(publisher);
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
        const spyLogger: jest.SpyInstance = jest
            .spyOn(publisher['logger'], 'log')
            .mockImplementation(() => {});
        putMetricData.mockReturnValueOnce({
            promise: jest.fn().mockRejectedValueOnce(
                awsUtil.error(new Error(), {
                    code: 'InternalServiceError',
                    message:
                        'An error occurred (InternalServiceError) when ' +
                        'calling the PutMetricData operation: ',
                })
            ),
        });
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

    test('metrics publisher proxy add metrics publisher null safe', () => {
        const proxy = new MetricsPublisherProxy();
        proxy.addMetricsPublisher(null);
        proxy.addMetricsPublisher(undefined);
        expect(proxy['publishers']).toMatchObject([]);
    });
});
