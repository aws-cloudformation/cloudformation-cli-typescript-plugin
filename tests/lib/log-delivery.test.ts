import CloudWatchLogs, {
    DescribeLogGroupsResponse,
} from 'aws-sdk/clients/cloudwatchlogs';
import S3, { ListObjectsV2Output } from 'aws-sdk/clients/s3';
import awsUtil from 'aws-sdk/lib/util';
import { inspect } from 'util';

import { SessionProxy } from '../../src/proxy';
import { MetricsPublisherProxy } from '../../src/metrics';
import {
    CloudWatchLogHelper,
    CloudWatchLogPublisher,
    LambdaLogPublisher,
    LoggerProxy,
    LogPublisher,
    S3LogHelper,
    S3LogPublisher,
} from '../../src/log-delivery';

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
const AWS_ACCOUNT_ID = '123456789012';
const LOG_GROUP_NAME = 'log-group-name';
const LOG_STREAM_NAME = 'log-stream-name';
const S3_BUCKET_NAME = 'log-group-name-123456789012';
const S3_FOLDER_NAME = 's3-folder-name';
const AWS_CONFIG = {
    region: 'us-east-1',
    accessKeyId: 'AAAAA',
    secretAccessKey: '11111',
};

jest.mock('aws-sdk/clients/cloudwatchlogs');
jest.mock('aws-sdk/clients/s3');
jest.mock('uuid', () => {
    return {
        v4: () => IDENTIFIER,
    };
});
jest.mock('../../src/metrics');

describe('when delivering logs', () => {
    let session: SessionProxy;
    let cwLogs: jest.Mock;
    let s3: jest.Mock;
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

    beforeAll(() => {
        session = new SessionProxy({});
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
        cwLogs.mockImplementation(() => {
            const returnValue = {
                createLogGroup,
                createLogStream,
                describeLogGroups,
                describeLogStreams,
                putLogEvents,
            };
            return {
                ...returnValue,
                config: AWS_CONFIG,
                makeRequest: (operation: string, params?: { [key: string]: any }) => {
                    return returnValue[operation](params);
                },
            };
        });
        createBucket = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        putObject = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        listObjectsV2 = mockResult({ ResponseMetadata: { RequestId: 'mock-request' } });
        s3 = (S3 as unknown) as jest.Mock;
        s3.mockImplementation((config) => {
            const returnValue = {
                createBucket,
                putObject,
                listObjectsV2,
            };
            return {
                ...returnValue,
                config,
                makeRequest: (operation: string, params?: { [key: string]: any }) => {
                    return returnValue[operation](params);
                },
            };
        });
        session['client'] = (name: string, options?: any): any => {
            if (name === 'CloudWatchLogs') return cwLogs(options);
            if (name === 'S3') return s3(options);
        };
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
        cloudWatchLogHelper.refreshClient({ region: AWS_CONFIG.region });
        spyCloudWatchPublish = jest.spyOn<any, any>(
            CloudWatchLogPublisher.prototype,
            'publishMessage'
        );
        cloudWatchLogger = new CloudWatchLogPublisher(
            session,
            LOG_GROUP_NAME,
            LOG_STREAM_NAME,
            console,
            metricsPublisherProxy
        );
        cloudWatchLogger.refreshClient({ region: AWS_CONFIG.region });
        s3LogHelper = new S3LogHelper(
            session,
            S3_BUCKET_NAME,
            S3_FOLDER_NAME,
            console,
            metricsPublisherProxy
        );
        s3LogHelper.refreshClient({ region: AWS_CONFIG.region });
        spyS3Publish = jest.spyOn<any, any>(S3LogPublisher.prototype, 'publishMessage');
        s3Logger = new S3LogPublisher(
            session,
            S3_BUCKET_NAME,
            S3_FOLDER_NAME,
            console,
            metricsPublisherProxy
        );
        s3Logger.refreshClient({ region: AWS_CONFIG.region });
        loggerProxy.addLogPublisher(cloudWatchLogger);
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
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
                console,
                null
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
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLambdaLogger'],
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
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
        });

        test('initialization create log group failure', async () => {
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLambdaLogger'],
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
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
        });

        test('initialization create log stream failure', async () => {
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                cloudWatchLogHelper['platformLambdaLogger'],
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
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
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
                null
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
            });
        });

        test('publish cloudwatch log with put events failure', async () => {
            expect.assertions(7);
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                cloudWatchLogger['platformLambdaLogger'],
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
            });
            expect(describeLogStreams).toHaveBeenCalledTimes(0);
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
        });

        test('publish cloudwatch log with describe failure', async () => {
            expect.assertions(8);
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                cloudWatchLogger['platformLambdaLogger'],
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
                expect(e).toBe('Publishing this log event should be retried.');
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
            });
            expect(describeLogStreams).toHaveBeenCalledTimes(1);
            expect(describeLogStreams).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP_NAME,
                    logStreamNamePrefix: LOG_STREAM_NAME,
                })
            );
            expect(publishExceptionMetric).toHaveBeenCalledTimes(1);
            expect(publishExceptionMetric).toHaveBeenCalledWith(
                expect.anything(),
                expect.anything()
            );
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
        });

        test('cloudwatch publisher without refreshing client', async () => {
            expect.assertions(1);
            const cloudWatchLogger = new CloudWatchLogPublisher(
                session,
                LOG_GROUP_NAME,
                LOG_STREAM_NAME,
                console,
                null
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
                null
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
                null
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
                    expect(e).toBe('Publishing this log event should be retried.');
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
                console,
                null
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
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                s3LogHelper['platformLambdaLogger'],
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
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
        });

        test('initialization create bucket failure', async () => {
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                s3LogHelper['platformLambdaLogger'],
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
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
        });

        test('initialization create folder failure', async () => {
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                s3LogHelper['platformLambdaLogger'],
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
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
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
                null
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
            const spyPlatformLambdaLogger = jest.spyOn<any, any>(
                s3Logger['platformLambdaLogger'],
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
            expect(spyPlatformLambdaLogger).toHaveBeenCalled();
        });

        test('s3 publisher without refreshing client', async () => {
            expect.assertions(1);
            const s3Logger = new S3LogPublisher(
                session,
                S3_BUCKET_NAME,
                S3_FOLDER_NAME,
                console,
                null
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
                null
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
                null
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
        test('process log with deserialize error', async () => {
            spyPublishLogEvent.mockRejectedValue(() => {
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
            expect(loggerProxy['queue'].length).toBe(1);
            await loggerProxy.processQueue();
            expect(loggerProxy['queue'].length).toBe(0);
            expect(mockToJson).toHaveBeenCalledTimes(1);
            expect(spyPublishLogEvent).toHaveBeenCalledTimes(2);
            expect(spyPublishLogEvent).toHaveBeenCalledWith(
                'undefined',
                expect.any(Date)
            );
        });

        test('logger proxy add filter', async () => {
            const filter = {
                applyFilter(message: string): string {
                    return message.replace(AWS_ACCOUNT_ID, '<REDACTED>');
                },
            };
            loggerProxy.addLogPublisher(lambdaLogger);
            loggerProxy.addFilter(filter);
            loggerProxy.log(`This is log message for account ${AWS_ACCOUNT_ID}`);
            await loggerProxy.processQueue();
            expect(spyLambdaPublish).toHaveBeenCalledWith(
                'This is log message for account <REDACTED>',
                expect.any(Date)
            );
            expect(spyCloudWatchPublish).toHaveBeenCalledWith(
                'This is log message for account <REDACTED>',
                expect.any(Date)
            );
        });

        test('logger proxy process with success', async () => {
            loggerProxy.addLogPublisher(lambdaLogger);
            loggerProxy.addLogPublisher(s3Logger);

            loggerProxy.log('count: [%d]', 5.12);
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-01'));
            expect(loggerProxy['queue'].length).toBe(6);
            await loggerProxy.processQueue();

            loggerProxy.log('timestamp: [%s]', new Date('2020-01-02'));
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-03'));
            loggerProxy.log('timestamp: [%s]', new Date('2020-01-04'));
            expect(loggerProxy['queue'].length).toBe(9);
            expect(inspect.defaultOptions.depth).toBe(8);
            await loggerProxy.processQueue();

            expect(cloudWatchLogger['logStreamName']).toBe(LOG_STREAM_NAME);
            expect(s3Logger['folderName']).toBe(S3_FOLDER_NAME);
            expect(loggerProxy['queue'].length).toBe(0);
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
    });
});
