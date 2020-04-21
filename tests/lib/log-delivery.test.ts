import { v4 as uuidv4 } from 'uuid';
import CloudWatchLogs from 'aws-sdk/clients/cloudwatchlogs';
import S3 from 'aws-sdk/clients/s3';
import awsUtil = require('aws-sdk/lib/util');

import { Action } from '../../src/interface';
import { SessionProxy } from '../../src/proxy';
import { ProviderLogHandler } from '../../src/log-delivery';
import { HandlerRequest, RequestData } from '../../src/utils';


const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output)
    });
};

const IDENTIFIER: string = 'f3390613-b2b5-4c31-a4c6-66813dff96a6';

const AWS_CONFIG = {
    region: 'us-east-1',
    accessKeyId: 'AAAAA',
    secretAccessKey: '11111',
};

jest.mock('aws-sdk/clients/cloudwatchlogs');
jest.mock('aws-sdk/clients/S3');
jest.mock('uuid', () => {
    return {
        v4: () => IDENTIFIER
    };
});

describe('when delivering log', () => {

    let payload: HandlerRequest;
    let session: SessionProxy;
    let providerLogHandler: ProviderLogHandler;
    let cwLogs: jest.Mock;
    let s3: jest.Mock;
    let createLogGroup: jest.Mock;
    let createLogStream: jest.Mock;
    let putLogEvents: jest.Mock;
    let createBucket: jest.Mock;
    let putObject: jest.Mock;

    beforeAll(() => {
        session = new SessionProxy({});
    });

    beforeEach(async () => {
        createLogGroup = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        createLogStream = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        putLogEvents = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        cwLogs = (CloudWatchLogs as unknown) as jest.Mock;
        cwLogs.mockImplementation(() => {
            const returnValue = {
                createLogGroup,
                createLogStream,
                putLogEvents,
            };
            return {
                ...returnValue,
                config: AWS_CONFIG,
                makeRequest: (operation: string, params?: {[key: string]: any}) => {
                    return returnValue[operation](params);
                }
            };
        });
        createBucket = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        putObject = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        s3 = (S3 as unknown) as jest.Mock;
        s3.mockImplementation((config) => {
            const returnValue = {
                createBucket,
                putObject,
            };
            return {
                ...returnValue,
                config,
                makeRequest: (operation: string, params?: {[key: string]: any}) => {
                    return returnValue[operation](params);
                }
            };
        });
        session['client'] = cwLogs;
        const request = new HandlerRequest(new Map(Object.entries({
            awsAccountId: '123412341234',
            resourceType: 'Foo::Bar::Baz',
            requestData: new RequestData(new Map(Object.entries({
                providerLogGroupName: 'test-group',
                logicalResourceId: 'MyResourceId',
                resourceProperties: {},
                systemTags: {},
            }))),
            stackId: 'arn:aws:cloudformation:us-east-1:123412341234:stack/baz/321',
        })));
        await ProviderLogHandler.setup(request, session);
        // Get a copy of the instance and remove it from class
        // to avoid changing singleton.
        providerLogHandler = ProviderLogHandler.getInstance();
        ProviderLogHandler['instance'] = null;
        cwLogs.mockClear();
        payload = new HandlerRequest(new Map(Object.entries({
            action: Action.Create,
            awsAccountId: '123412341234',
            bearerToken: uuidv4(),
            region: 'us-east-1',
            responseEndpoint: '',
            resourceType: 'Foo::Bar::Baz',
            resourceTypeVersion: '4',
            requestData: new RequestData(new Map(Object.entries({
                providerLogGroupName: 'test_group',
                logicalResourceId: 'MyResourceId',
                resourceProperties: {},
                systemTags: {},
            }))),
            stackId: 'arn:aws:cloudformation:us-east-1:123412341234:stack/baz/321',
        })));
    });

    afterEach(() => {
        ProviderLogHandler['instance'] = null;
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('class singleton check instance is null', () => {
        const instance = ProviderLogHandler.getInstance();
        expect(instance).toBeNull();
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
        providerLogHandler.logger.log('log-msg1');
        providerLogHandler.logger.log('log-msg2');
        jest.runAllImmediates();
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
        providerLogHandler.logger.log('log-msg3');
        providerLogHandler.logger.log('log-msg4');
        jest.runAllImmediates();
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

    test('log group create success', async () => {
        await providerLogHandler['createLogGroup']();
        expect(createLogGroup).toHaveBeenCalledTimes(1);
    });

    test('log stream create success', async () => {
        await providerLogHandler['createLogStream']();
        expect(createLogStream).toHaveBeenCalledTimes(1);
    });

    test('create already exists', async () => {
        await ['createLogGroup', 'createLogStream'].forEach(async (methodName: string) => {
            const mockLogsMethod: jest.Mock = jest.fn().mockReturnValue({
                promise: jest.fn().mockRejectedValueOnce(
                    awsUtil.error(new Error(), { code: 'ResourceAlreadyExistsException' })
                )
            });
            providerLogHandler.client[methodName] = mockLogsMethod;
            // Should not raise an exception if the log group already exists.
            await providerLogHandler[methodName]();
            expect(mockLogsMethod).toHaveBeenCalledTimes(1);
        });
    });

    test('put log event success', async () => {
        await [null, 'some-seq'].forEach(async (sequenceToken: string) => {
            providerLogHandler.sequenceToken = sequenceToken;
            const mockPut: jest.Mock = jest.fn().mockReturnValue({
                promise: jest.fn().mockResolvedValueOnce(
                    { nextSequenceToken: 'some-other-seq' }
                )
            });
            providerLogHandler.client.putLogEvents = mockPut;
            await providerLogHandler['putLogEvents']({
                message: 'log-msg',
                timestamp: undefined,
            });
            expect(mockPut).toHaveBeenCalledTimes(1);
        });
    });

    test('put log event invalid token', async () => {
        putLogEvents.mockReturnValue({
            promise: jest.fn().mockRejectedValueOnce(
                awsUtil.error(new Error(), { code: 'InvalidSequenceTokenException' })
            ).mockRejectedValueOnce(
                awsUtil.error(new Error(), { code: 'DataAlreadyAcceptedException' })
            ).mockResolvedValue(
                { nextSequenceToken: 'some-other-seq' }
            )
        });
        for(let i = 1; i < 4; i++) {
            await providerLogHandler['putLogEvents']({
                message: 'log-msg',
                timestamp: i,
            });
        }
        expect(putLogEvents).toHaveBeenCalledTimes(6);
    });

    test('emit existing cwl group stream', async () => {
        const mock: jest.Mock = jest.fn().mockResolvedValue({});
        providerLogHandler['putLogEvents'] = mock;
        jest.useFakeTimers();
        providerLogHandler.logger.log('log-msg1');
        providerLogHandler.logger.log('log-msg2');
        jest.runAllImmediates();
        expect(providerLogHandler['stack'].length).toBe(2);
        await providerLogHandler.processLogs();
        expect(providerLogHandler['stack'].length).toBe(0);
        expect(mock).toHaveBeenCalledTimes(3);
    });

    test('emit no group stream', async () => {
        const putLogEvents: jest.Mock = jest.fn().mockResolvedValue({})
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
        await providerLogHandler['deliverLogCloudWatch'](['log-msg']);
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
        providerLogHandler.emitter.emit('log', 'log-msg');
        expect(providerLogHandler['stack'].length).toBe(1);
        await providerLogHandler.processLogs();
        expect(providerLogHandler['stack'].length).toBe(0);
        expect(putLogEvents).toHaveBeenCalledTimes(5);
        expect(createLogGroup).toHaveBeenCalledTimes(1);
        expect(createLogStream).toHaveBeenCalledTimes(2);
    });

    test('put log s3 success', async () => {
        providerLogHandler['clientS3'] = new S3(AWS_CONFIG);
        await providerLogHandler['putLogObject']({
            groupName: providerLogHandler.groupName,
            stream: providerLogHandler.stream,
            messages: ['log-msg'],
        });
        expect(putObject).toHaveBeenCalledTimes(1);
    });

    test('emit no bucket', async () => {
        const putLogObject: jest.Mock = jest.fn().mockResolvedValue({})
            .mockRejectedValueOnce(
                awsUtil.error(new Error(), {
                    code: 'NoSuchBucket',
                    message: 'bucket does not exist',
                })
            );
        const createBucket: jest.Mock = jest.fn();
        providerLogHandler['putLogObject'] = putLogObject;
        providerLogHandler['createBucket'] = createBucket;
        providerLogHandler['deliverLogCloudWatch'] = jest.fn().mockRejectedValue(new Error(''));
        await providerLogHandler['initialize']();
        expect(providerLogHandler.clientS3.config).toEqual(
            expect.objectContaining(AWS_CONFIG)
        );
        await providerLogHandler['deliverLogS3'](['log-msg1']);
        providerLogHandler.emitter.emit('log', 'log-msg2');
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
        providerLogHandler.logger.log('log-msg1');
        providerLogHandler.logger.log('log-msg2');
        providerLogHandler.logger.log('log-msg3');
        jest.runAllImmediates();
        expect(providerLogHandler['stack'].length).toBe(4);
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
