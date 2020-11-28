import CloudWatchLogs, {
    DescribeLogGroupsResponse,
} from 'aws-sdk/clients/cloudwatchlogs';
import S3, { ListObjectsV2Output } from 'aws-sdk/clients/s3';
import awsUtil from 'aws-sdk/lib/util';
import { inspect } from 'util';
import WorkerPoolAwsSdk from 'worker-pool-aws-sdk';

import { SessionProxy } from '~/proxy';
import { MetricsPublisherProxy } from '~/metrics';
import { ServiceProperties } from '~/interface';
import {
    CloudWatchLogHelper,
    CloudWatchLogPublisher,
    LambdaLogPublisher,
    LoggerProxy,
    LogPublisher,
    S3LogHelper,
    S3LogPublisher,
} from '~/log-delivery';

const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output),
        httpRequest: {
            headers: {},
        },
        on: () => {},
    });
};

const IDENTIFIER = 'f3390613-b2b5-4c31-a4c6-66813dff96a6';

jest.mock('aws-sdk');
jest.mock('aws-sdk/clients/all');
jest.mock('aws-sdk/clients/cloudwatchlogs');
jest.mock('aws-sdk/clients/s3');
jest.mock('uuid', () => {
    return {
        v4: () => IDENTIFIER,
    };
});
jest.mock('~/metrics');

describe('when delivering logs', () => {
    const AWS_ACCOUNT_ID = '123456789012';
    const LOG_GROUP_NAME = 'log-group-name';
    const LOG_STREAM_NAME = 'log-stream-name';
    const S3_BUCKET_NAME = 'log-group-name-123456789012';
    const S3_FOLDER_NAME = 's3-folder-name';
    const AWS_CONFIG = {
        region: 'us-east-1',
        credentials: {
            accessKeyId: 'AAAAA',
            secretAccessKey: '11111',
        },
    };

    let session: SessionProxy;
    let cwLogs: jest.Mock<Partial<CloudWatchLogs>>;
    let s3: jest.Mock<Partial<S3>>;
    let createLogGroup: jest.Mock;
    let createLogStream: jest.Mock;
    let describeLogGroups: jest.Mock;
    let describeLogStreams: jest.Mock;
    let putLogEvents: jest.Mock;
    let createBucket: jest.Mock;
    let putObject: jest.Mock;
    let listObjectsV2: jest.Mock;
    let spyPublishLogEvent: jest.SpyInstance;
    let loggerProxy: LoggerProxy;
    let workerPool: WorkerPoolAwsSdk;
    let metricsPublisherProxy: MetricsPublisherProxy;
    let publishExceptionMetric: jest.Mock;
    let lambdaLogger: LambdaLogPublisher;
    let spyLambdaPublish: jest.SpyInstance;
    let cloudWatchLogHelper: CloudWatchLogHelper;
    let cloudWatchLogger: CloudWatchLogPublisher;
    let spyCloudWatchPublish: jest.SpyInstance;
    let s3LogHelper: S3LogHelper;
    let s3Logger: S3LogPublisher;
    let spyS3Publish: jest.SpyInstance;

    beforeAll(async () => {
        session = new SessionProxy(AWS_CONFIG);
        jest.spyOn<any, any>(WorkerPoolAwsSdk.prototype, 'runTask').mockRejectedValue(
            Error('Method runTask should not be called.')
        );
        workerPool = new WorkerPoolAwsSdk({ minThreads: 1, maxThreads: 1 });
        workerPool.runAwsTask = null;
    });

    beforeEach(async () => {
        createLogGroup = mockResult({
            ResponseMetadata: { RequestId: 'mock-request' },
        });
        createLogStream = mockResult({
            ResponseMetadata: { RequestId: 'mock-request' },
        });
        describeLogGroups = mockResult({
            ResponseMetadata: { RequestId: 'mock-request' },
        });
        describeLogStreams = mockResult({
            ResponseMetadata: { RequestId: 'mock-request' },
        });
        putLogEvents = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        cwLogs = (CloudWatchLogs as unknown) as jest.Mock;
        cwLogs.mockImplementation((config = {}) => {
            const returnValue: jest.Mocked<Partial<CloudWatchLogs>> = {
                createLogGroup,
                createLogStream,
                describeLogGroups,
                describeLogStreams,
                putLogEvents,
            };
            const ctor = CloudWatchLogs;
            ctor['serviceIdentifier'] = 'cloudwatchlogs';
            return {
                ...returnValue,
                config: { ...AWS_CONFIG, ...config, update: () => undefined },
                constructor: ctor,
                makeRequest: (
                    operation: ServiceProperties<CloudWatchLogs>,
                    params?: Record<string, any>
                ): any => {
                    return returnValue[operation](params as any);
                },
            };
        });
        createBucket = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        putObject = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        listObjectsV2 = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        s3 = (S3 as unknown) as jest.Mock;
        s3.mockImplementation((config = {}) => {
            const returnValue: jest.Mocked<Partial<S3>> = {
                createBucket,
                putObject,
                listObjectsV2,
            };
            const ctor = S3;
            ctor['serviceIdentifier'] = 's3';
            return {
                ...returnValue,
                config: { ...AWS_CONFIG, ...config, update: () => undefined },
                constructor: ctor,
                makeRequest: (
                    operation: ServiceProperties<S3>,
                    params?: Record<string, any>
                ): any => {
                    return (returnValue[operation] as any)(params);
                },
            };
        });
        loggerProxy = new LoggerProxy({ depth: 8 });
        metricsPublisherProxy = new MetricsPublisherProxy();
        publishExceptionMetric = mockResult({
            ResponseMetadata: { RequestId: 'mock-request' },
        });
        metricsPublisherProxy.publishLogDeliveryExceptionMetric = publishExceptionMetric;
        spyPublishLogEvent = jest.spyOn<any, any>(
            LogPublisher.prototype,
            'publishLogEvent'
        );
        spyLambdaPublish = jest.spyOn<any, any>(
            LambdaLogPublisher.prototype,
            'publishMessage'
        );
        lambdaLogger = new LambdaLogPublisher(console);
        cloudWatchLogHelper = new CloudWatchLogHelper(
            session,
            LOG_GROUP_NAME,
            LOG_STREAM_NAME,
            console,
            metricsPublisherProxy
        );
        cloudWatchLogHelper.refreshClient();
        spyCloudWatchPublish = jest.spyOn<any, any>(
            CloudWatchLogPublisher.prototype,
            'publishMessage'
        );
        cloudWatchLogger = new CloudWatchLogPublisher(
            session,
            LOG_GROUP_NAME,
            await cloudWatchLogHelper.prepareLogStream(),
            console,
            metricsPublisherProxy
        );
        cloudWatchLogger.refreshClient();
        await cloudWatchLogger.populateSequenceToken();
        s3LogHelper = new S3LogHelper(
            session,
            S3_BUCKET_NAME,
            S3_FOLDER_NAME,
            console,
            metricsPublisherProxy
        );
        s3LogHelper.refreshClient();
        spyS3Publish = jest.spyOn<any, any>(S3LogPublisher.prototype, 'publishMessage');
        s3Logger = new S3LogPublisher(
            session,
            S3_BUCKET_NAME,
            await s3LogHelper.prepareFolder(),
            console,
            metricsPublisherProxy
        );
        s3Logger.refreshClient();
        loggerProxy.addLogPublisher(cloudWatchLogger);
        workerPool.restart();
        loggerProxy.tracker.restart();
        jest.clearAllMocks();
    });

    afterEach(async () => {
        await loggerProxy.waitCompletion();
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    afterAll(async () => {
        await workerPool.shutdown();
    });

    describe('lambda log publisher', () => {
        test('publish lambda log happy flow', async () => {
            const msgToLog = 'How is it going?';
            await lambdaLogger.publishLogEvent(msgToLog);
            expect(spyLambdaPublish).toHaveBeenCalledTimes(1);
            expect(spyLambdaPublish).toHaveBeenCalledWith(msgToLog, expect.any(Date));
        });

        test('publish lambda log with failure', async () => {
            expect.assertions(2);
            const filter = {
                applyFilter(): string {
                    throw new Error('Sorry');
                },
            };
            const lambdaLogger = new LambdaLogPublisher(console);
            lambdaLogger.addFilter(filter);
            const msgToLog = 'How is it going?';
            try {
                await lambdaLogger.publishLogEvent(msgToLog);
            } catch (e) {
                expect(e.message).toBe('Sorry');
            }
            expect(spyLambdaPublish).toHaveBeenCalledTimes(0);
        });

        test('lambda publisher with filters', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            const lambdaLogger = new LambdaLogPublisher(console, filter);
            await lambdaLogger.publishLogEvent(
                `This is log message for account ${AWS_ACCOUNT_ID}`
            );
            expect(spyLambdaPublish).toHaveBeenCalledTimes(1);
            expect(spyLambdaPublish).toHaveBeenCalledWith(
                'This is log message for account <REDACTED>',
                expect.any(Date)
            );
        });
    });

    describe('cloudwatch log helper', () => {
        test('with existing log group', async () => {
            const spyDoesLogGroupExist = jest.spyOn<any, any>(
                CloudWatchLogHelper.prototype,
                'doesLogGroupExist'
            );
            const spyCreateLogGroup = jest.spyOn<any, any>(
                CloudWatchLogHelper.prototype,
                'createLogGroup'
            );
            describeLogGroups.mockReturnValue({
                promise: jest.fn().mockResolvedValueOnce({
                    logGroups: [
                        {
                            logGroupName: LOG_GROUP_NAME,
                            arn:
                                'arn:aws:loggers:us-east-1:123456789012:log-group:/aws/lambda/testLogGroup-X:*',
                            creationTime: 4567898765,
                            storedBytes: 456789,
                        },
                    ],
                } as DescribeLogGroupsResponse),
            });
            await cloudWatchLogHelper.prepareLogStream();
            expect(spyDoesLogGroupExist).toHaveBeenCalledTimes(1);
            expect(spyDoesLogGroupExist).toHaveReturnedWith(Promise.resolve(true));
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP_NAME })
            );
            expect(spyCreateLogGroup).toHaveBeenCalledTimes(0);
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamName: LOG_STREAM_NAME,
                })
            );
        });

        test('cloudwatch helper without refreshing client', async () => {
            expect.assertions(1);
            const cloudWatchLogHelper = new CloudWatchLogHelper(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console
            );
            try {
                await cloudWatchLogHelper.prepareLogStream();
            } catch (e) {
                expect(e.message).toMatch(/CloudWatchLogs client was not initialized/);
            }
        });

        test('with creating new log group', async () => {
            const spyDoesLogGroupExist = jest.spyOn<any, any>(
                CloudWatchLogHelper.prototype,
                'doesLogGroupExist'
            );
            const spyCreateLogGroup = jest.spyOn<any, any>(
                CloudWatchLogHelper.prototype,
                'createLogGroup'
            );
            await cloudWatchLogHelper.prepareLogStream();
            expect(spyDoesLogGroupExist).toHaveBeenCalledTimes(1);
            expect(spyDoesLogGroupExist).toHaveReturnedWith(Promise.resolve(false));
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP_NAME })
            );
            expect(spyCreateLogGroup).toHaveBeenCalledTimes(1);
            expect(spyCreateLogGroup).toHaveReturnedWith(
                Promise.resolve(LOG_GROUP_NAME)
            );
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogGroup).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupName: LOG_GROUP_NAME })
            );
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamName: LOG_STREAM_NAME,
                })
            );
        });

        test('initialization describe failure', async () => {
            const spyPlatformLogger = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLogger'],
                'log'
            );
            describeLogGroups.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'Sorry',
                    })
                ),
            });
            await cloudWatchLogHelper.prepareLogStream();
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP_NAME })
            );
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('initialization create log group failure', async () => {
            const spyPlatformLogger = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLogger'],
                'log'
            );
            createLogGroup.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
            });
            await cloudWatchLogHelper.prepareLogStream();
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP_NAME })
            );
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogGroup).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupName: LOG_GROUP_NAME })
            );
            expect(createLogStream).toHaveBeenCalledTimes(0);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('initialization create log stream failure', async () => {
            const spyPlatformLogger = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLogger'],
                'log'
            );
            createLogStream.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
            });
            await cloudWatchLogHelper.prepareLogStream();
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP_NAME })
            );
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogGroup).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupName: LOG_GROUP_NAME })
            );
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamName: LOG_STREAM_NAME,
                })
            );
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('create log group and stream already exist', async () => {
            createLogGroup.mockReturnValueOnce({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ResourceAlreadyExistsException',
                    })
                ),
            });
            // Should not raise an exception if the log group already exists.
            await cloudWatchLogHelper['createLogGroup']();
            expect(createLogGroup).toHaveBeenCalledTimes(1);

            createLogStream.mockReturnValueOnce({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ResourceAlreadyExistsException',
                    })
                ),
            });
            // Should not raise an exception if the log stream already exists.
            await cloudWatchLogHelper['createLogStream']();
            expect(createLogStream).toHaveBeenCalledTimes(1);
        });

        test('cloudwatch helper with null log stream', async () => {
            const cloudWatchLogHelper = new CloudWatchLogHelper(
                session,
                LOG_GROUP_NAME,
                null,
                console,
                null,
                workerPool
            );
            cloudWatchLogHelper.refreshClient();
            await cloudWatchLogHelper.prepareLogStream();
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamName: IDENTIFIER,
                })
            );
        });
    });

    describe('cloudwatch log publisher', () => {
        test('publish cloudwatch log happy flow', async () => {
            const msgToLog = 'How is it going?';
            await cloudWatchLogger.publishLogEvent(msgToLog);
            expect(spyCloudWatchPublish).toHaveBeenCalledTimes(1);
            expect(spyCloudWatchPublish).toHaveBeenCalledWith(
                msgToLog,
                expect.any(Date)
            );
            expect(putLogEvents).toHaveBeenCalledTimes(1);
            expect(putLogEvents).toHaveBeenCalledWith({
                logGroupName: LOG_GROUP_NAME,
                logStreamName: LOG_STREAM_NAME,
                logEvents: [
                    expect.objectContaining({
                        message: msgToLog,
                    }),
                ],
                sequenceToken: null,
            });
        });

        test('publish cloudwatch log with put events failure', async () => {
            expect.assertions(7);
            const spyPlatformLogger = jest.spyOn<any, any>(
                cloudWatchLogger['platformLogger'],
                'log'
            );
            putLogEvents.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
                on: (_event: string, callback: Function) => {
                    callback({ httpRequest: { headers: [] } });
                },
            });
            const msgToLog = 'How is it going?';
            try {
                await cloudWatchLogger.publishLogEvent(msgToLog);
            } catch (e) {
                expect(e.name).toBe('AccessDeniedException');
            }
            expect(putLogEvents).toHaveBeenCalledTimes(1);
            expect(putLogEvents).toHaveBeenCalledWith({
                logGroupName: LOG_GROUP_NAME,
                logStreamName: LOG_STREAM_NAME,
                logEvents: [
                    expect.objectContaining({
                        message: msgToLog,
                    }),
                ],
                sequenceToken: null,
            });
            expect(describeLogStreams).toHaveBeenCalledTimes(0);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('publish cloudwatch log with describe failure', async () => {
            expect.assertions(8);
            const spyPlatformLogger = jest.spyOn<any, any>(
                cloudWatchLogger['platformLogger'],
                'log'
            );
            putLogEvents.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ThrottlingException',
                    })
                ),
                on: () => {},
            });
            describeLogStreams.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
            });
            const msgToLog = 'How is it going?';
            try {
                await cloudWatchLogger.publishLogEvent(msgToLog);
            } catch (e) {
                expect(e.retryable).toBe(true);
            }
            expect(putLogEvents).toHaveBeenCalledTimes(1);
            expect(putLogEvents).toHaveBeenCalledWith({
                logGroupName: LOG_GROUP_NAME,
                logStreamName: LOG_STREAM_NAME,
                logEvents: [
                    expect.objectContaining({
                        message: msgToLog,
                    }),
                ],
                sequenceToken: null,
            });
            expect(describeLogStreams).toHaveBeenCalledTimes(1);
            expect(describeLogStreams).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamNamePrefix: LOG_STREAM_NAME,
                })
            );
            expect(publishExceptionMetric).toHaveBeenCalledTimes(2);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('cloudwatch publisher without refreshing client', async () => {
            expect.assertions(1);
            const cloudWatchLogger = new CloudWatchLogPublisher(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console
            );
            try {
                await cloudWatchLogger.publishLogEvent('How is it going?');
            } catch (e) {
                expect(e.message).toMatch(/CloudWatchLogs client was not initialized/);
            }
        });

        test('cloudwatch publisher with filters', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            const cloudWatchLogger = new CloudWatchLogPublisher(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console,
                null,
                workerPool,
                filter
            );
            cloudWatchLogger.refreshClient();
            await cloudWatchLogger.publishLogEvent(
                `This is log message for account ${AWS_ACCOUNT_ID}`
            );
            expect(putLogEvents).toHaveBeenCalledWith({
                logGroupName: LOG_GROUP_NAME,
                logStreamName: LOG_STREAM_NAME,
                logEvents: [
                    expect.objectContaining({
                        message: 'This is log message for account <REDACTED>',
                    }),
                ],
                sequenceToken: null,
            });
        });

        test('publish cloudwatch log with error and null metrics publisher', async () => {
            expect.assertions(5);
            const spyEmitMetrics = jest.spyOn<any, any>(
                CloudWatchLogPublisher.prototype,
                'emitMetricsForLoggingFailure'
            );
            putLogEvents.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
                on: () => {},
            });
            const cloudWatchLogger = new CloudWatchLogPublisher(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console,
                null,
                workerPool
            );
            cloudWatchLogger.refreshClient();
            const msgToLog = 'How is it going?';
            try {
                await cloudWatchLogger.publishLogEvent(msgToLog);
            } catch (e) {
                expect(e.code).toBe('AccessDeniedException');
            }
            expect(putLogEvents).toHaveBeenCalledTimes(1);
            expect(putLogEvents).toHaveBeenCalledWith({
                logGroupName: LOG_GROUP_NAME,
                logStreamName: LOG_STREAM_NAME,
                logEvents: [
                    expect.objectContaining({
                        message: msgToLog,
                    }),
                ],
                sequenceToken: null,
            });
            expect(spyEmitMetrics).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(0);
        });

        test('cloudwatch publisher with null log stream', async () => {
            const spySkipLogging = jest.spyOn<any, any>(
                CloudWatchLogPublisher.prototype,
                'skipLogging'
            );
            const cloudWatchLogger = new CloudWatchLogPublisher(
                session,
                LOG_GROUP_NAME,
                null,
                console,
                null,
                workerPool
            );
            cloudWatchLogger.refreshClient();
            const msgToLog = 'How is it going?';
            await cloudWatchLogger.publishLogEvent(msgToLog);
            expect(putLogEvents).toHaveBeenCalledTimes(0);
            expect(spySkipLogging).toHaveBeenCalledTimes(1);
            expect(spySkipLogging).toHaveReturnedWith(true);
        });

        test('publish cloudwatch message success', async () => {
            putLogEvents.mockReturnValue({
                promise: jest
                    .fn()
                    .mockResolvedValueOnce({
                        nextSequenceToken: 'second-seq',
                    })
                    .mockResolvedValueOnce({
                        nextSequenceToken: 'first-seq',
                    }),
                on: () => {},
            });

            cloudWatchLogger['nextSequenceToken'] = null;
            await cloudWatchLogger.publishLogEvent('msg');

            cloudWatchLogger['nextSequenceToken'] = 'some-seq';
            await cloudWatchLogger.publishLogEvent('msg');

            expect(putLogEvents).toHaveBeenCalledTimes(2);
        });

        test('publish cloudwatch log with invalid token', async () => {
            expect.assertions(4);
            putLogEvents.mockReturnValue({
                promise: jest
                    .fn()
                    .mockRejectedValueOnce(
                        awsUtil.error(new Error(), {
                            code: 'InvalidSequenceTokenException',
                        })
                    )
                    .mockRejectedValueOnce(
                        awsUtil.error(new Error(), {
                            code: 'DataAlreadyAcceptedException',
                        })
                    )
                    .mockResolvedValue({ nextSequenceToken: 'some-other-seq' }),
                on: () => {},
            });
            describeLogStreams.mockReturnValue({
                promise: jest.fn().mockResolvedValue({
                    logStreams: [{ uploadSequenceToken: 'some-other-seq' }],
                }),
            });
            for (let i = 1; i < 4; i++) {
                try {
                    await cloudWatchLogger.publishLogEvent('log-msg');
                } catch (e) {
                    expect(e.retryable).toBe(true);
                }
            }
            expect(putLogEvents).toHaveBeenCalledTimes(3);
            expect(describeLogStreams).toHaveBeenCalledTimes(2);
        });
    });

    describe('s3 log helper', () => {
        test('with existing bucket', async () => {
            const spyDoesFolderExist = jest.spyOn<any, any>(
                S3LogHelper.prototype,
                'doesFolderExist'
            );
            const spyCreateBucket = jest.spyOn<any, any>(
                S3LogHelper.prototype,
                'createBucket'
            );
            await s3LogHelper.prepareFolder();
            expect(spyDoesFolderExist).toHaveBeenCalledTimes(1);
            expect(spyDoesFolderExist).toHaveReturnedWith(Promise.resolve(false));
            expect(listObjectsV2).toHaveBeenCalledTimes(1);
            expect(listObjectsV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Prefix: `${S3_FOLDER_NAME}/`,
                })
            );
            expect(spyCreateBucket).toHaveBeenCalledTimes(0);
            expect(createBucket).toHaveBeenCalledTimes(0);
            expect(putObject).toHaveBeenCalledTimes(1);
        });

        test('with existing folder', async () => {
            const spyDoesFolderExist = jest.spyOn<any, any>(
                S3LogHelper.prototype,
                'doesFolderExist'
            );
            const spyCreateBucket = jest.spyOn<any, any>(
                S3LogHelper.prototype,
                'createBucket'
            );
            listObjectsV2.mockReturnValue({
                promise: jest.fn().mockResolvedValueOnce({
                    Contents: [
                        {
                            Key: `${S3_FOLDER_NAME}/`,
                            LastModified: new Date(),
                            ETag: '"d41d8cd98f00b204e9800998ecf8427e"',
                            Size: 0,
                            StorageClass: 'STANDARD',
                        },
                    ],
                } as ListObjectsV2Output),
            });
            await s3LogHelper.prepareFolder();
            expect(spyDoesFolderExist).toHaveBeenCalledTimes(1);
            expect(spyDoesFolderExist).toHaveReturnedWith(Promise.resolve(true));
            expect(listObjectsV2).toHaveBeenCalledTimes(1);
            expect(listObjectsV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Prefix: `${S3_FOLDER_NAME}/`,
                })
            );
            expect(spyCreateBucket).toHaveBeenCalledTimes(0);
            expect(createBucket).toHaveBeenCalledTimes(0);
            expect(putObject).toHaveBeenCalledTimes(0);
        });

        test('s3 helper without refreshing client', async () => {
            expect.assertions(1);
            const s3LogHelper = new S3LogHelper(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console
            );
            try {
                await s3LogHelper.prepareFolder();
            } catch (e) {
                expect(e.message).toMatch(/S3 client was not initialized/);
            }
        });

        test('with creating new bucket', async () => {
            const spyDoesFolderExist = jest.spyOn<any, any>(
                S3LogHelper.prototype,
                'doesFolderExist'
            );
            const spyCreateBucket = jest.spyOn<any, any>(
                S3LogHelper.prototype,
                'createBucket'
            );
            listObjectsV2.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'NoSuchBucket',
                    })
                ),
            });
            await s3LogHelper.prepareFolder();
            expect(spyDoesFolderExist).toHaveBeenCalledTimes(1);
            expect(spyDoesFolderExist).toHaveReturnedWith(Promise.resolve(null));
            expect(listObjectsV2).toHaveBeenCalledTimes(1);
            expect(listObjectsV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Prefix: `${S3_FOLDER_NAME}/`,
                })
            );
            expect(spyCreateBucket).toHaveBeenCalledTimes(1);
            expect(spyCreateBucket).toHaveReturnedWith(Promise.resolve(S3_BUCKET_NAME));
            expect(createBucket).toHaveBeenCalledTimes(1);
            expect(createBucket).toHaveBeenCalledWith(
                expect.objectContaining({ Bucket: S3_BUCKET_NAME })
            );
            expect(putObject).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: `${S3_FOLDER_NAME}/`,
                    ContentLength: 0,
                })
            );
        });

        test('initialization list failure', async () => {
            const spyPlatformLogger = jest.spyOn<any, any>(
                s3LogHelper['platformLogger'],
                'log'
            );
            listObjectsV2.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'Sorry',
                    })
                ),
            });
            await s3LogHelper.prepareFolder();
            expect(listObjectsV2).toHaveBeenCalledTimes(1);
            expect(listObjectsV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Prefix: `${S3_FOLDER_NAME}/`,
                })
            );
            expect(createBucket).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('initialization create bucket failure', async () => {
            const spyPlatformLogger = jest.spyOn<any, any>(
                s3LogHelper['platformLogger'],
                'log'
            );
            listObjectsV2.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'NoSuchBucket',
                    })
                ),
            });
            createBucket.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
            });
            await s3LogHelper.prepareFolder();
            expect(listObjectsV2).toHaveBeenCalledTimes(1);
            expect(listObjectsV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Prefix: `${S3_FOLDER_NAME}/`,
                })
            );
            expect(createBucket).toHaveBeenCalledTimes(1);
            expect(createBucket).toHaveBeenCalledWith(
                expect.objectContaining({ Bucket: S3_BUCKET_NAME })
            );
            expect(putObject).toHaveBeenCalledTimes(0);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(2);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('initialization create folder failure', async () => {
            const spyPlatformLogger = jest.spyOn<any, any>(
                s3LogHelper['platformLogger'],
                'log'
            );
            putObject.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
            });
            await s3LogHelper.prepareFolder();
            expect(listObjectsV2).toHaveBeenCalledTimes(1);
            expect(listObjectsV2).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Prefix: `${S3_FOLDER_NAME}/`,
                })
            );
            expect(createBucket).toHaveBeenCalledTimes(0);
            expect(putObject).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: `${S3_FOLDER_NAME}/`,
                    ContentLength: 0,
                })
            );
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('create bucket already exist', async () => {
            createBucket.mockReturnValueOnce({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'BucketAlreadyExists',
                    })
                ),
            });
            // Should not raise an exception if the bucket already exists.
            await s3LogHelper['createBucket']();
            expect(createBucket).toHaveBeenCalledTimes(1);
        });

        test('s3 helper with null folder', async () => {
            const s3LogHelper = new S3LogHelper(
                session,
                S3_BUCKET_NAME,
                null,
                console,
                null,
                workerPool
            );
            s3LogHelper.refreshClient();
            await s3LogHelper.prepareFolder();
            expect(putObject).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: `${IDENTIFIER}/`,
                    ContentLength: 0,
                })
            );
        });
    });

    describe('s3 log publisher', () => {
        test('publish s3 log happy flow', async () => {
            const msgToLog = 'How is it going?';
            await s3Logger.publishLogEvent(msgToLog);
            expect(spyS3Publish).toHaveBeenCalledTimes(1);
            expect(spyS3Publish).toHaveBeenCalledWith(msgToLog, expect.any(Date));
            expect(putObject).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: expect.stringContaining(`${S3_FOLDER_NAME}/`),
                    ContentType: 'text/plain',
                    Body: msgToLog,
                })
            );
        });

        test('publish s3 log with put object failure', async () => {
            expect.assertions(6);
            const spyPlatformLogger = jest.spyOn<any, any>(
                s3Logger['platformLogger'],
                'log'
            );
            putObject.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
            });
            const msgToLog = 'How is it going?';
            try {
                await s3Logger.publishLogEvent(msgToLog);
            } catch (e) {
                expect(e.name).toBe('AccessDeniedException');
            }
            expect(putObject).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: expect.stringContaining(`${S3_FOLDER_NAME}/`),
                    ContentType: 'text/plain',
                    Body: msgToLog,
                })
            );
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLogger).toHaveBeenCalled();
        });

        test('s3 publisher without refreshing client', async () => {
            expect.assertions(1);
            const s3Logger = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console
            );
            try {
                await s3Logger.publishLogEvent('How is it going?');
            } catch (e) {
                expect(e.message).toMatch(/S3 client was not initialized/);
            }
        });

        test('s3 publisher with filters', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            const s3Logger = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console,
                null,
                workerPool,
                filter
            );
            s3Logger.refreshClient();
            await s3Logger.publishLogEvent(
                `This is log message for account ${AWS_ACCOUNT_ID}`
            );
            expect(putObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: expect.stringContaining(`${S3_FOLDER_NAME}/`),
                    ContentType: 'text/plain',
                    Body: 'This is log message for account <REDACTED>',
                })
            );
        });

        test('publish s3 log with error and null metrics publisher', async () => {
            expect.assertions(5);
            const spyEmitMetrics = jest.spyOn<any, any>(
                S3LogPublisher.prototype,
                'emitMetricsForLoggingFailure'
            );
            putObject.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'AccessDeniedException',
                    })
                ),
            });
            const s3Logger = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console,
                null,
                workerPool
            );
            s3Logger.refreshClient();
            const msgToLog = 'How is it going?';
            try {
                await s3Logger.publishLogEvent(msgToLog);
            } catch (e) {
                expect(e.code).toBe('AccessDeniedException');
            }
            expect(putObject).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledWith(
                expect.objectContaining({
                    Bucket: S3_BUCKET_NAME,
                    Key: expect.stringContaining(`${S3_FOLDER_NAME}/`),
                    ContentType: 'text/plain',
                    Body: msgToLog,
                })
            );
            expect(spyEmitMetrics).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(0);
        });

        test('s3 publisher with null folder', async () => {
            const spySkipLogging = jest.spyOn<any, any>(
                S3LogPublisher.prototype,
                'skipLogging'
            );
            const s3Logger = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                null,
                console,
                null,
                workerPool
            );
            s3Logger.refreshClient();
            const msgToLog = 'How is it going?';
            await s3Logger.publishLogEvent(msgToLog);
            expect(putObject).toHaveBeenCalledTimes(0);
            expect(spySkipLogging).toHaveBeenCalledTimes(1);
            expect(spySkipLogging).toHaveReturnedWith(true);
        });
    });

    describe('logger proxy', () => {
        test('should process log with deserialize error', async () => {
            spyPublishLogEvent.mockRejectedValueOnce(() => {
                throw new Error();
            });
            const mockToJson: jest.Mock = jest.fn().mockReturnValue(() => {
                throw new Error();
            });
            class Unserializable {
                message = 'msg';
                toJSON = mockToJson;
            }
            const unserializable = new Unserializable();
            loggerProxy.log('%j', unserializable);
            await loggerProxy.waitCompletion();
            expect(mockToJson).toHaveBeenCalledTimes(1);
            expect(spyPublishLogEvent).toHaveBeenCalledTimes(1);
            expect(spyPublishLogEvent).toHaveBeenCalledWith(
                'undefined',
                expect.any(Date)
            );
        });

        test('should add filter', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            loggerProxy.addLogPublisher(lambdaLogger);
            loggerProxy.addFilter(filter);
            loggerProxy.log(`This is log message for account ${AWS_ACCOUNT_ID}`);
            await loggerProxy.waitCompletion();
            expect(spyLambdaPublish).toHaveBeenCalledWith(
                'This is log message for account <REDACTED>',
                expect.any(Date)
            );
            expect(spyCloudWatchPublish).toHaveBeenCalledWith(
                'This is log message for account <REDACTED>',
                expect.any(Date)
            );
        });

        test('should process with success', async () => {
            loggerProxy.addLogPublisher(lambdaLogger);
            loggerProxy.addLogPublisher(s3Logger);

            loggerProxy.log('count: [%d]', 5.12);
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-01'));

            loggerProxy.log('timestamp: [%s]', new Date('2020-01-02'));
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-03'));
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-04'));
            expect(inspect.defaultOptions.depth).toBe(8);
            await loggerProxy.waitCompletion();

            expect(cloudWatchLogger['logStreamName']).toBe(LOG_STREAM_NAME);
            expect(s3Logger['folderName']).toBe(S3_FOLDER_NAME);
            expect(spyLambdaPublish).toHaveBeenCalledTimes(5);
            expect(spyLambdaPublish).toHaveBeenCalledWith(
                'count: [5.12]',
                expect.any(Date)
            );
            expect(spyLambdaPublish).toHaveBeenCalledWith(
                'timestamp: [2020-01-01T00:00:00.000Z]',
                expect.any(Date)
            );
            expect(spyCloudWatchPublish).toHaveBeenCalledTimes(5);
            expect(spyCloudWatchPublish).toHaveBeenCalledWith(
                'count: [5.12]',
                expect.any(Date)
            );
            expect(spyCloudWatchPublish).toHaveBeenCalledWith(
                'timestamp: [2020-01-01T00:00:00.000Z]',
                expect.any(Date)
            );
            expect(putLogEvents).toHaveBeenCalledTimes(5);
            expect(spyS3Publish).toHaveBeenCalledTimes(5);
            expect(spyS3Publish).toHaveBeenCalledWith(
                'count: [5.12]',
                expect.any(Date)
            );
            expect(spyS3Publish).toHaveBeenCalledWith(
                'timestamp: [2020-01-01T00:00:00.000Z]',
                expect.any(Date)
            );
            expect(putObject).toHaveBeenCalledTimes(5);
        });

        test('should process log again with retryable error', async () => {
            expect.assertions(4);
            const returnedValue = { nextSequenceToken: 'some-other-seq' };
            putLogEvents.mockReturnValue({
                promise: jest
                    .fn()
                    .mockRejectedValueOnce(
                        awsUtil.error(new Error(), {
                            code: 'InvalidSequenceTokenException',
                            message:
                                'The given sequenceToken is invalid. The next expected sequenceToken is: 495579999999900356407851919528174642',
                        })
                    )
                    .mockResolvedValue(returnedValue),
                on: () => {},
            });
            const msgToLog = 'How is it going?';
            loggerProxy.log(msgToLog);
            await loggerProxy.waitCompletion();
            expect(spyPublishLogEvent).toHaveBeenCalledTimes(2);
            expect(spyPublishLogEvent).toHaveBeenCalledWith(msgToLog, expect.any(Date));
            expect(spyPublishLogEvent).toHaveNthReturnedWith(
                1,
                Promise.resolve(
                    expect.objectContaining({
                        retryable: true,
                    })
                )
            );
            expect(spyPublishLogEvent).toHaveNthReturnedWith(
                2,
                Promise.resolve(returnedValue)
            );
        });

        test('should swallow error on wait tracker failure', async () => {
            const spyWaitCompletion = jest
                .spyOn<any, any>(loggerProxy['tracker'], 'waitCompletion')
                .mockRejectedValueOnce('some random error');
            loggerProxy.log('How is it going?');
            const result = await loggerProxy.waitCompletion();
            expect(result).toBe(true);
            expect(spyWaitCompletion).toHaveBeenCalledTimes(1);
            expect(spyPublishLogEvent).toHaveBeenCalledTimes(1);
        });
    });
});
