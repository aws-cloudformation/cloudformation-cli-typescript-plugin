import { v4 as uuidv4 } from 'uuid';
import CloudWatchLogs from 'aws-sdk/clients/cloudwatchlogs';
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

jest.mock('aws-sdk/clients/cloudwatchlogs');
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
    let createLogGroup: jest.Mock;
    let createLogStream: jest.Mock;
    let putLogEvents: jest.Mock;

    beforeAll(() => {
        session = new SessionProxy({});
    });

    beforeEach(() => {
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
                makeRequest: (operation: string, params?: {[key: string]: any}) => {
                    return returnValue[operation](params);
                }
            };
        });
        session['client'] = cwLogs;
        const Mock = jest.fn<ProviderLogHandler, any[]>(() => {
            const request = new HandlerRequest(new Map(Object.entries({
                resourceType: 'Foo::Bar::Baz',
                requestData: new RequestData(new Map(Object.entries({
                    providerLogGroupName: 'test-group',
                    logicalResourceId: 'MyResourceId',
                    resourceProperties: {},
                    systemTags: {},
                }))),
                stackId: 'an-arn',
            })));
            ProviderLogHandler.setup(request, session);
            // Get a copy of the instance and remove it from class
            // to avoid changing the singleton.
            const instance = ProviderLogHandler.getInstance();
            ProviderLogHandler['instance'] = null;
            cwLogs.mockClear();
            return instance;
        });
        providerLogHandler = new Mock();
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
            stackId: 'an-arn',
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

    test('setup with provider creds and stack id and logical resource id', () => {
        ProviderLogHandler.setup(payload, session);
        expect(cwLogs).toHaveBeenCalledTimes(1);
        expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
        const logHandler = ProviderLogHandler.getInstance();
        expect(logHandler.stream).toContain(payload.stackId);
        expect(logHandler.stream).toContain(payload.requestData.logicalResourceId);
    });

    test('setup with provider creds without stack id', () => {
        payload.stackId = null;
        ProviderLogHandler.setup(payload, session);
        expect(cwLogs).toHaveBeenCalledTimes(1);
        expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
        const logHandler = ProviderLogHandler.getInstance();
        expect(logHandler.stream).toContain(payload.awsAccountId);
        expect(logHandler.stream).toContain(payload.region);
    });

    test('setup with provider creds without logical resource id', () => {
        payload.requestData.logicalResourceId = null;
        ProviderLogHandler.setup(payload, session);
        expect(cwLogs).toHaveBeenCalledTimes(1);
        expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
        const logHandler = ProviderLogHandler.getInstance();
        expect(logHandler.stream).toContain(payload.awsAccountId);
        expect(logHandler.stream).toContain(payload.region);
    });

    test('setup existing logger', () => {
        ProviderLogHandler.setup(payload, session);
        const oldInstance = ProviderLogHandler.getInstance();
        expect(cwLogs).toHaveBeenCalledTimes(1);
        expect(cwLogs).toHaveBeenCalledWith('CloudWatchLogs');
        ProviderLogHandler.setup(payload, session);
        const newInstance = ProviderLogHandler.getInstance();
        expect(newInstance).toBe(oldInstance);
        expect(newInstance.stream).toContain(payload.stackId);
        expect(newInstance.stream).toContain(payload.requestData.logicalResourceId);
    });

    test('setup without log group should not set up', () => {
        payload.requestData.providerLogGroupName = '';
        ProviderLogHandler.setup(payload, session);
        const logHandler = ProviderLogHandler.getInstance();
        expect(logHandler).toBeNull();
    });

    test('setup without session should not set up', () => {
        ProviderLogHandler.setup(payload, null);
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

    test('create already exists', () => {
        ['createLogGroup', 'createLogStream'].forEach(async (methodName: string) => {
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

    test('put log event success', () => {
        [null, 'some-seq'].forEach(async (sequenceToken: string) => {
            providerLogHandler.sequenceToken = sequenceToken;
            const mockPut: jest.Mock = jest.fn().mockReturnValue({
                promise: jest.fn().mockResolvedValueOnce(
                    { nextSequenceToken: 'some-other-seq' }
                )
            });
            providerLogHandler.client.putLogEvents = mockPut;
            await providerLogHandler['putLogEvents']({
                message: 'log-msg',
                timestamp: 123,
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
        expect(putLogEvents).toHaveBeenCalledTimes(5);
    });

    test('emit existing cwl group stream', async () => {
        const mock: jest.Mock = jest.fn().mockResolvedValue({});
        providerLogHandler['putLogEvents'] = mock;
        providerLogHandler['emitter'].emit('log', 'log-msg');
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(mock).toHaveBeenCalledTimes(1);
    });

    test('emit no group stream', async () => {
        const putLogEvents: jest.Mock = jest.fn().mockResolvedValue({}).mockRejectedValueOnce(
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
        await providerLogHandler['logListener']('log-msg');
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
        console.log('log-msg');
        await new Promise(resolve => setTimeout(resolve, 300));
        expect(putLogEvents).toHaveBeenCalledTimes(4);
        expect(createLogGroup).toHaveBeenCalledTimes(1);
        expect(createLogStream).toHaveBeenCalledTimes(2);
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
