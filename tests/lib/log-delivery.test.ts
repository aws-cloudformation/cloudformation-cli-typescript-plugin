import { v4 as uuidv4 } from 'uuid';
import CloudWatchLogs, {
    DescribeLogGroupsResponse,
} from 'aws-sdk/clients/cloudwatchlogs';
import S3 from 'aws-sdk/clients/s3';
import awsUtil from 'aws-sdk/lib/util';
import { AWSError } from 'aws-sdk';
import promiseSequential from 'promise-sequential';

import { Action } from '../../src/interface';
import { SessionProxy } from '../../src/proxy';
import { MetricsPublisherProxy } from '../../src/metrics';
import {
    CloudWatchLogHelper,
    CloudWatchLogPublisher,
    LambdaLogPublisher,
    LoggerProxy,
    S3LogHelper,
    S3LogPublisher,
} from '../../src/log-delivery';
import { HandlerRequest, RequestData } from '../../src/interface';

const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output),
        httpRequest: {
            headers: {},
        },
    });
};

const IDENTIFIER = 'f3390613-b2b5-4c31-a4c6-66813dff96a6';
const LOG_GROUP = 'log-group-name';
const BUCKET_NAME = 'log-group-name-123456789012';
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

describe('when delivering logs', () => {
    let payload: HandlerRequest;
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
        loggerProxy = new LoggerProxy();
        metricsPublisherProxy = new MetricsPublisherProxy();
        publishExceptionMetric = mockResult({
            ResponseMetadata: { RequestId: 'mock-request' },
        });
        metricsPublisherProxy.publishLogDeliveryExceptionMetric = publishExceptionMetric;
        spyLambdaPublish = jest.spyOn<any, any>(
            LambdaLogPublisher.prototype,
            'publishMessage'
        );
        lambdaLogger = new LambdaLogPublisher(console);
        cloudWatchLogHelper = new CloudWatchLogHelper(
            session,
            LOG_GROUP,
            null,
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
            LOG_GROUP,
            await cloudWatchLogHelper.prepareLogStream(),
            console,
            metricsPublisherProxy
        );
        cloudWatchLogger.refreshClient({ region: AWS_CONFIG.region });
        s3LogHelper = new S3LogHelper(session, BUCKET_NAME, null, console, null);
        s3LogHelper.refreshClient({ region: AWS_CONFIG.region });
        spyS3Publish = jest.spyOn<any, any>(S3LogPublisher.prototype, 'publishMessage');
        s3Logger = new S3LogPublisher(
            session,
            BUCKET_NAME,
            await s3LogHelper.prepareFolder(),
            console,
            metricsPublisherProxy
        );
        s3Logger.refreshClient({ region: AWS_CONFIG.region });
        loggerProxy.addLogPublisher(cloudWatchLogger);
        const request = new HandlerRequest({
            awsAccountId: '123456789012',
            resourceType: 'Foo::Bar::Baz',
            requestData: new RequestData({
                providerLogGroupName: 'test-group',
                logicalResourceId: 'MyResourceId',
                resourceProperties: {},
                systemTags: {},
            }),
            stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/baz/321',
        });
        payload = new HandlerRequest({
            action: Action.Create,
            awsAccountId: '123456789012',
            bearerToken: uuidv4(),
            region: 'us-east-1',
            responseEndpoint: '',
            resourceType: 'Foo::Bar::Baz',
            resourceTypeVersion: '4',
            requestData: new RequestData({
                providerLogGroupName: 'test_group',
                logicalResourceId: 'MyResourceId',
                resourceProperties: {},
                systemTags: {},
            }),
            stackId: 'arn:aws:cloudformation:us-east-1:123456789012:stack/baz/321',
        });
        jest.clearAllMocks();
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe.only('cloudwatch log helper', () => {
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
                            logGroupName: LOG_GROUP,
                            arn:
                                'arn:aws:loggers:us-east-1:123456789012:log-group:/aws/lambda/testLogGroup-X:*',
                            creationTime: 4567898765,
                            storedBytes: 456789,
                        },
                    ],
                } as DescribeLogGroupsResponse),
            });
            await cloudWatchLogHelper['prepareLogStream']();
            expect(spyDoesLogGroupExist).toHaveBeenCalledTimes(1);
            expect(spyDoesLogGroupExist).toHaveReturnedWith(Promise.resolve(true));
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP })
            );
            expect(spyCreateLogGroup).toHaveBeenCalledTimes(0);
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP,
                    logStreamName: IDENTIFIER,
                })
            );
        });

        test('without refreshing client', async () => {
            expect.assertions(1);
            const cloudWatchLogHelper = new CloudWatchLogHelper(
                session,
                LOG_GROUP,
                'log-stream-name',
                console,
                metricsPublisherProxy
            );
            try {
                await cloudWatchLogHelper['prepareLogStream']();
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
            await cloudWatchLogHelper['prepareLogStream']();
            expect(spyDoesLogGroupExist).toHaveBeenCalledTimes(1);
            expect(spyDoesLogGroupExist).toHaveReturnedWith(Promise.resolve(false));
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP })
            );
            expect(spyCreateLogGroup).toHaveBeenCalledTimes(1);
            expect(spyCreateLogGroup).toHaveReturnedWith(Promise.resolve(LOG_GROUP));
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogGroup).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupName: LOG_GROUP })
            );
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP,
                    logStreamName: IDENTIFIER,
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
            await cloudWatchLogHelper['prepareLogStream']();
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP })
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
                        name: 'AccessDenied',
                    })
                ),
            });
            await cloudWatchLogHelper['prepareLogStream']();
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP })
            );
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogGroup).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupName: LOG_GROUP })
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
                        name: 'AccessDenied',
                    })
                ),
            });
            await cloudWatchLogHelper['prepareLogStream']();
            expect(describeLogGroups).toHaveBeenCalledTimes(1);
            expect(describeLogGroups).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupNamePrefix: LOG_GROUP })
            );
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogGroup).toHaveBeenCalledWith(
                expect.objectContaining({ logGroupName: LOG_GROUP })
            );
            expect(createLogStream).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledWith(
                expect.objectContaining({
                    logGroupName: LOG_GROUP,
                    logStreamName: IDENTIFIER,
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

        // test('log group create fail', async () => {
        //     expect.assertions(2);
        //     createLogGroup.mockReturnValue({
        //         promise: jest.fn().mockRejectedValueOnce(
        //             awsUtil.error(new Error(), {
        //                 code: 'ServiceUnavailableException',
        //             })
        //         ),
        //     });
        //     try {
        //         await cloudWatchLogHelper['createLogGroup']();
        //     } catch (e) {
        //         expect(e).toMatchObject({ code: 'ServiceUnavailableException' });
        //         expect(createLogGroup).toHaveBeenCalledTimes(1);
        //     }
        // });

        // test('log stream create success', async () => {
        //     await cloudWatchLogHelper['createLogStream']();
        //     expect(createLogStream).toHaveBeenCalledTimes(1);
        // });

        // test('log stream create fail', async () => {
        //     expect.assertions(2);
        //     createLogStream.mockReturnValue({
        //         promise: jest.fn().mockRejectedValueOnce(
        //             awsUtil.error(new Error(), {
        //                 code: 'ServiceUnavailableException',
        //             })
        //         ),
        //     });
        //     try {
        //         await cloudWatchLogHelper['createLogStream']();
        //     } catch (e) {
        //         expect(e).toMatchObject({ code: 'ServiceUnavailableException' });
        //         expect(createLogStream).toHaveBeenCalledTimes(1);
        //     }
        // });
    });

    test('logger proxy successful setup', async () => {
        loggerProxy.addLogPublisher(lambdaLogger);
        loggerProxy.addLogPublisher(s3Logger);

        loggerProxy.log('count: [%d]', 5.12);
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-01'));
        expect(loggerProxy['queue'].length).toBe(6);
        await loggerProxy.processQueue();

        loggerProxy.log('timestamp: [%s]', new Date('2020-01-02'));
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-03'));
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-04'));
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-05'));
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-06'));
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-07'));
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-08'));
        loggerProxy.log('timestamp: [%s]', new Date('2020-01-09'));
        expect(loggerProxy['queue'].length).toBe(24);
        await loggerProxy.processQueue();

        expect(cloudWatchLogger['logStreamName']).toBe(IDENTIFIER);
        expect(s3Logger['folderName']).toBe(IDENTIFIER);
        expect(loggerProxy['queue'].length).toBe(0);
        expect(spyLambdaPublish).toHaveBeenCalledTimes(10);
        expect(spyLambdaPublish).toHaveBeenCalledWith('count: [5.12]');
        expect(spyLambdaPublish).toHaveBeenCalledWith(
            'timestamp: [2020-01-01T00:00:00.000Z]'
        );
        expect(spyCloudWatchPublish).toHaveBeenCalledTimes(10);
        expect(spyCloudWatchPublish).toHaveBeenCalledWith('count: [5.12]');
        expect(spyCloudWatchPublish).toHaveBeenCalledWith(
            'timestamp: [2020-01-01T00:00:00.000Z]'
        );
        expect(putLogEvents).toHaveBeenCalledTimes(10);
        expect(spyS3Publish).toHaveBeenCalledTimes(10);
        expect(spyS3Publish).toHaveBeenCalledWith('count: [5.12]');
        expect(spyS3Publish).toHaveBeenCalledWith(
            'timestamp: [2020-01-01T00:00:00.000Z]'
        );
        expect(putObject).toHaveBeenCalledTimes(10);
    });

    test('put log event success', async () => {
        putLogEvents.mockReturnValue({
            promise: jest
                .fn()
                .mockResolvedValueOnce({
                    nextSequenceToken: 'second-seq',
                })
                .mockResolvedValueOnce({
                    nextSequenceToken: 'first-seq',
                }),
        });

        await promiseSequential(
            [null, 'some-seq'].map((sequenceToken: string) => {
                return async () => {
                    cloudWatchLogger['nextSequenceToken'] = sequenceToken;
                    await cloudWatchLogger['publishMessage']('msg');
                };
            })
        );
        expect(putLogEvents).toHaveBeenCalledTimes(2);
    });

    test('put log event invalid token', async () => {
        expect.assertions(2);
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
        });
        describeLogStreams.mockReturnValue({
            promise: jest.fn().mockResolvedValue({
                logStreams: [{ uploadSequenceToken: 'some-other-seq' }],
            }),
        });
        for (let i = 1; i < 4; i++) {
            await cloudWatchLogger.publishLogEvent('log-msg');
        }
        expect(putLogEvents).toHaveBeenCalledTimes(3);
        expect(describeLogStreams).toHaveBeenCalledTimes(2);
    });

    test('cloudwatch log with deserialize error', async () => {
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
        expect(spyCloudWatchPublish).toHaveBeenCalledTimes(1);
        expect(spyCloudWatchPublish).toHaveBeenCalledWith('undefined');
        expect(putLogEvents).toHaveBeenCalledTimes(1);
    });

    test('s3 bucket create success', async () => {
        await s3LogHelper['createBucket']();
        expect(createBucket).toHaveBeenCalledTimes(1);
    });

    test('s3 bucket create fail', async () => {
        expect.assertions(2);
        createBucket.mockReturnValue({
            promise: jest.fn().mockRejectedValueOnce(
                awsUtil.error(new Error(), {
                    code: 'ServiceUnavailableException',
                })
            ),
        });
        try {
            await s3LogHelper['createBucket']();
        } catch (e) {
            expect(e).toMatchObject({ code: 'ServiceUnavailableException' });
            expect(createBucket).toHaveBeenCalledTimes(1);
        }
    });

    test('s3 log folder create success', async () => {
        await s3LogHelper['createFolder']();
        expect(listObjectsV2).toHaveBeenCalledTimes(1);
        expect(putObject).toHaveBeenCalledTimes(1);
    });

    test('s3 log folder create fail', async () => {
        expect.assertions(3);
        putObject.mockReturnValue({
            promise: jest.fn().mockRejectedValueOnce(
                awsUtil.error(new Error(), {
                    code: 'ServiceUnavailableException',
                })
            ),
        });
        try {
            await s3LogHelper['createFolder']();
        } catch (e) {
            expect(e).toMatchObject({ code: 'ServiceUnavailableException' });
            expect(listObjectsV2).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledTimes(1);
        }
    });

    test('emit no bucket', async () => {
        const putLogObject: jest.Mock = jest
            .fn()
            .mockResolvedValue({})
            .mockRejectedValueOnce(
                awsUtil.error(new Error(), {
                    code: 'NoSuchBucket',
                    message: 'bucket does not exist',
                })
            );
        const createFolder = jest.fn();
        const createBucket = jest.fn();
        s3LogHelper['createBucket'] = createBucket;
        s3LogHelper['createFolder'] = createFolder;
        const awsConfig = { region: AWS_CONFIG.region };
        s3Logger.refreshClient(awsConfig);
        expect(s3Logger['client'].config).toEqual(expect.objectContaining(awsConfig));

        await s3LogHelper['prepareFolder']();

        // Function createBucket should not be called again if the bucket already exists.
        createFolder.mockRejectedValueOnce(
            awsUtil.error(new Error(), {
                statusCode: 400,
                message: '',
            })
        );
        await s3LogHelper['prepareFolder']();
        expect(createBucket).toHaveBeenCalledTimes(2);
        expect(createFolder).toHaveBeenCalledTimes(1);

        loggerProxy['logPublishers'].length = 0;
        loggerProxy.addLogPublisher(s3Logger);

        loggerProxy.log('msg1');
        loggerProxy.log('msg2');
        loggerProxy.log('msg3');
        expect(loggerProxy['queue'].length).toBe(3);
        await loggerProxy.processQueue();
        expect(loggerProxy['queue'].length).toBe(0);
        expect(putObject).toHaveBeenCalledTimes(3);
    });

    /*
    describe('provider log handler DEPRECATED', () => {
        test('class singleton check instance is null', () => {
            const instance = ProviderLogHandler.getInstance();
            expect(instance).toBeNull();
        });

        test('setup with initialize error', async () => {
            const spyConsoleDebug: jest.SpyInstance = jest
                .spyOn(global.console, 'debug')
                .mockImplementation(() => {});
            const spyInitialize = jest
                .spyOn<any, any>(ProviderLogHandler.prototype, 'initialize')
                .mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'InternalServiceError',
                        message: 'An error occurred during initialization.',
                    })
                );
            const logHandler = await ProviderLogHandler.setup(payload, session);
            expect(spyInitialize).toHaveBeenCalledTimes(1);
            expect(logHandler).toBeFalsy();
            expect(spyConsoleDebug).toHaveBeenCalledTimes(1);
            expect(spyConsoleDebug).toHaveBeenCalledWith(
                'Error on ProviderLogHandler setup:',
                expect.any(Error)
            );
        });

        test('setup with provider creds and stack id and logical resource id', async () => {
            await ProviderLogHandler.setup(payload, session);
            expect(cwLogs).toHaveBeenCalledTimes(1);
            expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
            const logHandler = ProviderLogHandler.getInstance();
            const stackId = payload.stackId.replace(/:/g, '__');
            expect(logHandler.stream).toContain(stackId);
            expect(logHandler.stream).toContain(payload.requestData.logicalResourceId);
        });

        test('setup with provider creds without stack id', async () => {
            payload.stackId = null;
            await ProviderLogHandler.setup(payload, session);
            expect(cwLogs).toHaveBeenCalledTimes(1);
            expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
            const logHandler = ProviderLogHandler.getInstance();
            expect(logHandler.stream).toContain(payload.awsAccountId);
            expect(logHandler.stream).toContain(payload.region);
        });

        test('setup with provider creds without logical resource id', async () => {
            payload.requestData.logicalResourceId = null;
            await ProviderLogHandler.setup(payload, session);
            expect(cwLogs).toHaveBeenCalledTimes(1);
            expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
            const logHandler = ProviderLogHandler.getInstance();
            expect(logHandler.stream).toContain(payload.awsAccountId);
            expect(logHandler.stream).toContain(payload.region);
        });

        test('setup existing logger', async () => {
            await ProviderLogHandler.setup(payload, session);
            const oldInstance = ProviderLogHandler.getInstance();
            expect(cwLogs).toHaveBeenCalledTimes(1);
            expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
            jest.useFakeTimers();
            providerLogHandler.logger.log('msg1');
            providerLogHandler.logger.log('msg2');
            jest.runAllImmediates();
            jest.useRealTimers();
            expect(providerLogHandler['stack'].length).toBe(2);
            await providerLogHandler.processLogs();
            expect(providerLogHandler['stack'].length).toBe(0);

            await ProviderLogHandler.setup(payload, session);
            const newInstance = ProviderLogHandler.getInstance();
            expect(newInstance).toBe(oldInstance);
            const stackId = payload.stackId.replace(/:/g, '__');
            expect(newInstance.stream).toContain(stackId);
            expect(newInstance.stream).toContain(payload.requestData.logicalResourceId);
            jest.useFakeTimers();
            providerLogHandler.logger.log('msg3');
            providerLogHandler.logger.log('msg4');
            jest.runAllImmediates();
            jest.useRealTimers();
            expect(providerLogHandler['stack'].length).toBe(2);
            await providerLogHandler.processLogs();
            expect(providerLogHandler['stack'].length).toBe(0);
        });

        test('setup without log group should not set up', async () => {
            payload.requestData.providerLogGroupName = '';
            await ProviderLogHandler.setup(payload, session);
            const logHandler = ProviderLogHandler.getInstance();
            expect(logHandler).toBeNull();
        });

        test('setup without session should not set up', async () => {
            await ProviderLogHandler.setup(payload, null);
            const logHandler = ProviderLogHandler.getInstance();
            expect(logHandler).toBeNull();
        });

        test('log group create fail', async () => {
            createLogGroup.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ServiceUnavailableException',
                    })
                ),
            });
            await expect(providerLogHandler['createLogGroup']()).rejects.toThrow(
                AWSError
            );
            expect(createLogGroup).toHaveBeenCalledTimes(1);
        });

        test('log stream create success', async () => {
            await providerLogHandler['createLogStream']();
            expect(createLogStream).toHaveBeenCalledTimes(1);
        });

        test('log stream create fail', async () => {
            createLogStream.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ServiceUnavailableException',
                    })
                ),
            });
            await expect(providerLogHandler['createLogStream']()).rejects.toThrow(
                AWSError
            );
            expect(createLogStream).toHaveBeenCalledTimes(1);
        });

        test('create already exists', async () => {
            await promiseSequential(
                ['createLogGroup', 'createLogStream'].map((methodName: string) => {
                    return async () => {
                        const mockLogsMethod: jest.Mock = jest.fn().mockReturnValue({
                            promise: jest.fn().mockRejectedValueOnce(
                                awsUtil.error(new Error(), {
                                    code: 'ResourceAlreadyExistsException',
                                })
                            ),
                        });
                        providerLogHandler.client[methodName] = mockLogsMethod;
                        // Should not raise an exception if the log group already exists.
                        await providerLogHandler[methodName]();
                        expect(mockLogsMethod).toHaveBeenCalledTimes(1);
                    };
                })
            );
        });

        test('put log event success', async () => {
            await promiseSequential(
                [null, 'some-seq'].map((sequenceToken: string) => {
                    return async () => {
                        providerLogHandler.sequenceToken = sequenceToken;
                        const mockPut: jest.Mock = jest.fn().mockReturnValue({
                            promise: jest.fn().mockResolvedValueOnce({
                                nextSequenceToken: 'some-other-seq',
                            }),
                        });
                        providerLogHandler.client.putLogEvents = mockPut;
                        await providerLogHandler['putLogEvents']({
                            message: 'msg',
                            timestamp: undefined,
                        });
                        expect(mockPut).toHaveBeenCalledTimes(1);
                    };
                })
            );
        });

        test('put log event invalid token', async () => {
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
            });
            describeLogStreams.mockReturnValue({
                promise: jest.fn().mockResolvedValue({
                    logStreams: [{ uploadSequenceToken: 'some-other-seq' }],
                }),
            });
            for (let i = 1; i < 4; i++) {
                await providerLogHandler['putLogEvents']({
                    message: 'log-msg',
                    timestamp: i,
                });
            }
            expect(putLogEvents).toHaveBeenCalledTimes(4);
            expect(describeLogStreams).toHaveBeenCalledTimes(2);
        });

        test('emit existing cwl group stream', async () => {
            const mock: jest.Mock = jest.fn().mockResolvedValue({});
            providerLogHandler['putLogEvents'] = mock;
            jest.useFakeTimers();
            providerLogHandler.logger.log('msg1');
            providerLogHandler.logger.info('INFO msg2');
            providerLogHandler.logger.debug('msg3');
            jest.runAllImmediates();
            jest.useRealTimers();
            expect(providerLogHandler['stack'].length).toBe(2);
            await providerLogHandler.processLogs();
            expect(providerLogHandler['stack'].length).toBe(0);
            expect(mock).toHaveBeenCalledTimes(3);
            expect(mock).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    message: '{"messages":["LOG","msg1"]}',
                })
            );
            expect(mock).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    message: '{"messages":["INFO msg2"]}',
                })
            );
            expect(mock).toHaveBeenNthCalledWith(
                3,
                expect.objectContaining({
                    message: '{"messages":["Log delivery finalized."]}',
                })
            );
        });

        test('emit no group stream', async () => {
            const putLogEvents: jest.Mock = jest
                .fn()
                .mockResolvedValue({})
                .mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ResourceNotFoundException',
                        message: 'log group does not exist',
                    })
                );
            const createLogGroup: jest.Mock = jest.fn();
            const createLogStream: jest.Mock = jest.fn();
            providerLogHandler['putLogEvents'] = putLogEvents;
            providerLogHandler['createLogGroup'] = createLogGroup;
            providerLogHandler['createLogStream'] = createLogStream;
            await providerLogHandler['deliverLogCloudWatch'](['msg']);
            expect(putLogEvents).toHaveBeenCalledTimes(2);
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledTimes(1);

            // Function createGroup should not be called again if the group already exists.
            putLogEvents.mockRejectedValueOnce(
                awsUtil.error(new Error(), {
                    code: 'ResourceNotFoundException',
                    message: 'log stream does not exist',
                })
            );
            providerLogHandler.logger.log('msg');
            expect(providerLogHandler['stack'].length).toBe(1);
            await providerLogHandler.processLogs();
            expect(providerLogHandler['stack'].length).toBe(0);
            expect(putLogEvents).toHaveBeenCalledTimes(5);
            expect(createLogGroup).toHaveBeenCalledTimes(1);
            expect(createLogStream).toHaveBeenCalledTimes(2);
        });

        test('cloudwatch log with deserialize error', async () => {
            const mockToJson: jest.Mock = jest.fn().mockReturnValue(() => {
                throw new Error();
            });
            class Unserializable {
                message = 'msg';
                toJSON = mockToJson;
            }
            const unserializable = new Unserializable();
            providerLogHandler.logger.log(unserializable);
            expect(providerLogHandler['stack'].length).toBe(1);
            await providerLogHandler.processLogs();
            expect(providerLogHandler['stack'].length).toBe(0);
            expect(mockToJson).toHaveBeenCalledTimes(1);
            expect(putObject).toHaveBeenCalledTimes(0);
        });

        test('s3 bucket create success', async () => {
            providerLogHandler['clientS3'] = new S3(AWS_CONFIG);
            await providerLogHandler['createBucket']();
            expect(createBucket).toHaveBeenCalledTimes(1);
        });

        test('s3 bucket create fail', async () => {
            providerLogHandler['clientS3'] = new S3(AWS_CONFIG);
            createBucket.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ServiceUnavailableException',
                    })
                ),
            });
            await expect(providerLogHandler['createBucket']()).rejects.toThrow(
                AWSError
            );
            expect(createBucket).toHaveBeenCalledTimes(1);
        });

        test('s3 log put success', async () => {
            providerLogHandler['clientS3'] = new S3(AWS_CONFIG);
            await providerLogHandler['putLogObject']({
                groupName: providerLogHandler.groupName,
                stream: providerLogHandler.stream,
                messages: ['msg'],
            });
            expect(putObject).toHaveBeenCalledTimes(1);
        });

        test('s3 log put fail', async () => {
            providerLogHandler['clientS3'] = new S3(AWS_CONFIG);
            putObject.mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'ServiceUnavailableException',
                    })
                ),
            });
            await expect(
                providerLogHandler['putLogObject']({
                    groupName: providerLogHandler.groupName,
                    stream: providerLogHandler.stream,
                    messages: ['msg'],
                })
            ).rejects.toThrow(AWSError);
            expect(putObject).toHaveBeenCalledTimes(1);
        });

        test('emit no bucket', async () => {
            const putLogObject: jest.Mock = jest
                .fn()
                .mockResolvedValue({})
                .mockRejectedValueOnce(
                    awsUtil.error(new Error(), {
                        code: 'NoSuchBucket',
                        message: 'bucket does not exist',
                    })
                );
            const createBucket: jest.Mock = jest.fn();
            providerLogHandler['putLogObject'] = putLogObject;
            providerLogHandler['createBucket'] = createBucket;
            providerLogHandler['deliverLogCloudWatch'] = jest
                .fn()
                .mockRejectedValue(new Error(''));
            await providerLogHandler['initialize']();
            expect(providerLogHandler.clientS3.config).toEqual(
                expect.objectContaining(AWS_CONFIG)
            );
            await providerLogHandler['deliverLogS3'](['msg1']);
            await providerLogHandler['deliverLogS3'](['msg2']);
            expect(putLogObject).toHaveBeenCalledTimes(4);
            expect(createBucket).toHaveBeenCalledTimes(1);

            // Function createBucket should not be called again if the bucket already exists.
            putLogObject.mockRejectedValueOnce(
                awsUtil.error(new Error(), {
                    statusCode: 400,
                    message: '',
                })
            );
            jest.useFakeTimers();
            providerLogHandler.logger.log('msg1');
            providerLogHandler.logger.log('msg2');
            providerLogHandler.logger.log('msg3');
            jest.runAllImmediates();
            jest.useRealTimers();
            expect(providerLogHandler['stack'].length).toBe(3);
            await providerLogHandler.processLogs();
            expect(providerLogHandler['stack'].length).toBe(0);
            expect(putLogObject).toHaveBeenCalledTimes(9);
            expect(createBucket).toHaveBeenCalledTimes(1);
        });

        test('get instance no logger present', () => {
            ProviderLogHandler['instance'] = undefined;
            const actual = ProviderLogHandler.getInstance();
            expect(actual).toBeNull();
        });

        test('get instance logger present', () => {
            const expected = providerLogHandler;
            ProviderLogHandler['instance'] = providerLogHandler;
            const actual = ProviderLogHandler.getInstance();
            expect(actual).toBe(expected);
        });
    });
    */
});
