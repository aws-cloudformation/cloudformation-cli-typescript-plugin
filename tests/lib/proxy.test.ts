import STS from 'aws-sdk/clients/sts';
import WorkerPoolAwsSdk from 'worker-pool-aws-sdk';

import { ProgressEvent, SessionProxy } from '~/proxy';
import { BaseModel, HandlerErrorCode, OperationStatus, Optional } from '~/interface';

jest.mock('aws-sdk/clients/sts');
jest.mock('worker-pool-aws-sdk');

const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output),
        httpRequest: { headers: {} },
        on: jest.fn().mockImplementation((_event: string, listener: () => void) => {
            if (listener) {
                listener();
            }
        }),
    });
};

describe('when getting session proxy', () => {
    class ResourceModel extends BaseModel {
        public static readonly TYPE_NAME: string = 'Test::Resource::Model';

        public somekey: Optional<string>;
        public someotherkey: Optional<string>;
    }

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe('session proxy', () => {
        const AWS_CONFIG = {
            region: 'us-east-1',
            credentials: {
                accessKeyId: 'AAAAA',
                secretAccessKey: '11111',
            },
        };

        test('should return modified client with worker pool', async () => {
            const workerPool = new WorkerPoolAwsSdk({ minThreads: 1, maxThreads: 1 });
            workerPool.runTask = null;
            workerPool.runAwsTask = jest.fn().mockResolvedValue(true);
            const proxy = new SessionProxy(AWS_CONFIG);
            const client = proxy.client(new STS(), null, workerPool);
            expect(proxy).toBeInstanceOf(SessionProxy);
            expect(proxy.configuration).toMatchObject(AWS_CONFIG);
            const result = await client.makeRequestPromise('getCallerIdentity', {});
            expect(result).toBe(true);
            expect(workerPool.runAwsTask).toHaveBeenCalledTimes(1);
        });

        test('should return modified client with service instance input', async () => {
            const workerPool = new WorkerPoolAwsSdk({ minThreads: 1, maxThreads: 1 });
            workerPool.runTask = null;
            workerPool.runAwsTask = jest.fn().mockRejectedValue(null);
            const proxy = new SessionProxy(AWS_CONFIG);
            const modifiedConfig = { ...AWS_CONFIG, region: 'us-east-2' };
            const mockMakeRequest = mockResult(true);
            ((STS as unknown) as jest.Mock).mockImplementation(() => {
                const ctor = STS;
                ctor['serviceIdentifier'] = 'sts';
                return {
                    config: { ...modifiedConfig, update: () => modifiedConfig },
                    constructor: ctor,
                    makeRequest: mockMakeRequest,
                };
            });
            const client = proxy.client(new STS(), modifiedConfig, workerPool);
            expect(proxy).toBeInstanceOf(SessionProxy);
            expect(client.config).toMatchObject(modifiedConfig);
            const result = await client.makeRequestPromise(
                'getCallerIdentity',
                {},
                { 'X-Dummy-Header': 'DUMMY HEADER' }
            );
            expect(result).toBe(true);
            expect(mockMakeRequest).toHaveBeenCalledTimes(1);
        });

        test('should return proxy with get session credentials argument', () => {
            const proxy = SessionProxy.getSession(
                AWS_CONFIG.credentials,
                AWS_CONFIG.region
            );
            expect(proxy).toBeInstanceOf(SessionProxy);
            expect(proxy.client('CloudWatch')).toBeDefined();
        });

        test('should return null with get session null argument', () => {
            const proxy = SessionProxy.getSession(null);
            expect(proxy).toBeNull();
        });
    });

    describe('progress event', () => {
        test('should fail with json serializable', () => {
            const errorCode = HandlerErrorCode.AlreadyExists;
            const message = 'message of failed event';
            const event = ProgressEvent.failed(errorCode, message);
            expect(event.status).toBe(OperationStatus.Failed);
            expect(event.errorCode).toBe(errorCode);
            expect(event.message).toBe(message);
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Failed,
                errorCode: errorCode,
                message,
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with context', () => {
            const message = 'message of event with context';
            const event = ProgressEvent.builder()
                .callbackContext({ a: 'b' })
                .message(message)
                .status(OperationStatus.Success)
                .build();
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Success,
                message,
                callbackContext: {
                    a: 'b',
                },
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with model', () => {
            const message = 'message of event with model';
            const model = new ResourceModel({
                somekey: 'a',
                someotherkey: 'b',
                somenullkey: null,
            });
            const event = ProgressEvent.progress<ProgressEvent<ResourceModel>>(
                model,
                null
            );
            event.message = message;
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.InProgress,
                message,
                resourceModel: {
                    somekey: 'a',
                    someotherkey: 'b',
                },
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with models', () => {
            const message = 'message of event with models';
            const models = [
                new ResourceModel({
                    somekey: 'a',
                    someotherkey: 'b',
                }),
                new ResourceModel({
                    somekey: 'c',
                    someotherkey: 'd',
                }),
            ];
            const event = new ProgressEvent<ResourceModel>({
                status: OperationStatus.Success,
                message,
                resourceModels: models,
            });
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Success,
                message,
                resourceModels: [
                    {
                        somekey: 'a',
                        someotherkey: 'b',
                    },
                    {
                        somekey: 'c',
                        someotherkey: 'd',
                    },
                ],
                callbackDelaySeconds: 0,
            });
        });

        test('should serialize to response with error code', () => {
            const message = 'message of event with error code';
            const event = new ProgressEvent({
                status: OperationStatus.Failed,
                message,
                errorCode: HandlerErrorCode.InvalidRequest,
            });
            const serialized = event.serialize();
            expect(serialized).toMatchObject({
                status: OperationStatus.Failed,
                message,
                errorCode: HandlerErrorCode.InvalidRequest,
                callbackDelaySeconds: 0,
            });
        });
    });
});
