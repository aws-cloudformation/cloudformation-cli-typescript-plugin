import CloudWatchLogs from 'aws-sdk/clients/cloudwatchlogs';

import { ProgressEvent, SessionProxy } from '~/proxy';
import { BaseModel, HandlerErrorCode, OperationStatus, Optional } from '~/interface';

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

        test('should return modified client with service instance input', () => {
            const proxy = new SessionProxy(AWS_CONFIG);
            const modifiedConfig = { ...AWS_CONFIG, region: 'us-east-2' };
            const client = proxy.client(new CloudWatchLogs(), modifiedConfig);
            expect(proxy).toBeInstanceOf(SessionProxy);
            expect(client.config).toMatchObject(modifiedConfig);
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
