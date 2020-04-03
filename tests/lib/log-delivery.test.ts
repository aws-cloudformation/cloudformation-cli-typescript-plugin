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
            // Get a copy of the instance to avoid changing the singleton
            const instance = ProviderLogHandler.getInstance();
            ProviderLogHandler['instance'] = null;
            cwLogs.mockClear();
            return instance;
        });
        providerLogHandler = new Mock();
    });

    beforeEach(() => {
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

    test('log group create success', () => {
        providerLogHandler.client.createLogGroup();
        expect(createLogGroup).toHaveBeenCalledTimes(1);
    });

    test('log stream create success', () => {
        providerLogHandler.client.createLogStream();
        expect(createLogStream).toHaveBeenCalledTimes(1);
    });

    test('create already exists', () => {
        ['createLogGroup', 'createLogStream'].forEach((methodName: string) => {
            const mockLogsMethod: jest.Mock = jest.fn().mockImplementationOnce(() => {
                throw awsUtil.error(new Error(), { code: 'ResourceAlreadyExistsException' });
            });
            providerLogHandler.client[methodName] = mockLogsMethod;
            // Should not raise an exception if the log group already exists.
            providerLogHandler[methodName]();
            expect(mockLogsMethod).toHaveBeenCalledTimes(1);
        });
    });

    test('put log event success', () => {
        [null, 'some-seq'].forEach((sequenceToken: string) => {
            providerLogHandler.sequenceToken = sequenceToken;
            const mockPut: jest.Mock = jest.fn().mockImplementationOnce(() => {
                return { nextSequenceToken: 'some-other-seq' };
            });
            providerLogHandler.client.putLogEvents = mockPut;
            providerLogHandler['putLogEvent']({
                message: 'log-msg',
                timestamp: 123,
            });
            expect(mockPut).toHaveBeenCalledTimes(1);
        });
    });

    test('put log event invalid token', () => {
        const mockPut: jest.Mock = jest.fn().mockImplementationOnce(() => {
            throw awsUtil.error(new Error(), { code: 'InvalidSequenceTokenException' });
        })
        .mockImplementationOnce(() => {
            throw awsUtil.error(new Error(), { code: 'DataAlreadyAcceptedException' });
        })
        .mockImplementation(() => {
            return { nextSequenceToken: 'some-other-seq' };
        });
        providerLogHandler.client.putLogEvents = mockPut;
        for(let i = 1; i < 4; i++) {
            providerLogHandler['putLogEvent']({
                message: 'log-msg',
                timestamp: i,
            });
        }
        expect(mockPut).toHaveBeenCalledTimes(5);
    });

    test('emit existing cwl group stream', () => {
        const mock: jest.Mock = jest.fn();
        providerLogHandler['putLogEvent'] = mock;
        providerLogHandler['emitter'].emit('log', 'log-msg');
        expect(mock).toHaveBeenCalledTimes(1);
    });

    test('emit no group stream', () => {
        const putLogEvent: jest.Mock = jest.fn().mockImplementationOnce(() => {
            throw awsUtil.error(new Error(), { message: 'log group does not exist' });
        });
        const createLogGroup: jest.Mock = jest.fn();
        const createLogStream: jest.Mock = jest.fn();
        providerLogHandler['putLogEvent'] = putLogEvent;
        providerLogHandler['createLogGroup'] = createLogGroup;
        providerLogHandler['createLogStream'] = createLogStream;
        providerLogHandler['emitter'].emit('log', 'log-msg');
        expect(putLogEvent).toHaveBeenCalledTimes(2);
        expect(createLogGroup).toHaveBeenCalledTimes(1);
        expect(createLogStream).toHaveBeenCalledTimes(1);

        // Function createGroup should not be called again if the group already exists.
        putLogEvent.mockImplementationOnce(() => {
            throw awsUtil.error(new Error(), { message: 'log stream does not exist' });
        });
        providerLogHandler['emitter'].emit('log', 'log-msg');
        expect(putLogEvent).toHaveBeenCalledTimes(4);
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
