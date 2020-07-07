import { ProgressEvent, SessionProxy } from '../../src/proxy';
import {
    BaseModel,
    Credentials,
    HandlerErrorCode,
    OperationStatus,
    Optional,
} from '../../src/interface';

describe('when getting session proxy', () => {
    const BEARER_TOKEN = 'f3390613-b2b5-4c31-a4c6-66813dff96a6';

    class ResourceModel extends BaseModel {
        public static readonly TYPE_NAME: string = 'Test::Resource::Model';

        public somekey: Optional<string>;
        public someotherkey: Optional<string>;
    }

    test('get session returns proxy', () => {
        const proxy: SessionProxy = SessionProxy.getSession({
            accessKeyId: '',
            secretAccessKey: '',
            sessionToken: '',
        } as Credentials);
        expect(proxy).toBeInstanceOf(SessionProxy);
        expect(proxy.client('CloudWatch')).toBeDefined();
    });

    test('get session returns null', () => {
        const proxy: SessionProxy = SessionProxy.getSession(null);
        expect(proxy).toBeNull();
    });

    test('progress event failed is json serializable', () => {
        const errorCode: HandlerErrorCode = HandlerErrorCode.AlreadyExists;
        const message = 'message of failed event';
        const event: ProgressEvent = ProgressEvent.failed(errorCode, message);
        expect(event.status).toBe(OperationStatus.Failed);
        expect(event.errorCode).toBe(errorCode);
        expect(event.message).toBe(message);
        const serialized = event.serialize();
        expect(serialized).toEqual(
            new Map(
                Object.entries({
                    status: OperationStatus.Failed,
                    errorCode: errorCode,
                    message,
                    callbackDelaySeconds: 0,
                })
            )
        );
    });

    test('progress event serialize to response with context', () => {
        const message = 'message of event with context';
        const event = ProgressEvent.builder()
            .callbackContext({ a: 'b' })
            .message(message)
            .status(OperationStatus.Success)
            .build();
        const serialized = event.serialize();
        expect(serialized).toEqual(
            new Map(
                Object.entries({
                    status: OperationStatus.Success,
                    message,
                    callbackContext: {
                        a: 'b',
                    },
                    callbackDelaySeconds: 0,
                })
            )
        );
    });

    test('progress event serialize to response with model', () => {
        const message = 'message of event with model';
        const model = new ResourceModel(
            new Map(
                Object.entries({
                    somekey: 'a',
                    someotherkey: 'b',
                    somenullkey: null,
                })
            )
        );
        const event = new ProgressEvent(
            new Map(
                Object.entries({
                    status: OperationStatus.Success,
                    message,
                    resourceModel: model,
                })
            )
        );
        const serialized = event.serialize();
        expect(serialized).toEqual(
            new Map(
                Object.entries({
                    status: OperationStatus.Success,
                    message,
                    resourceModel: {
                        somekey: 'a',
                        someotherkey: 'b',
                    },
                    callbackDelaySeconds: 0,
                })
            )
        );
    });

    test('progress event serialize to response with models', () => {
        const message = 'message of event with models';
        const models = [
            new ResourceModel(
                new Map(
                    Object.entries({
                        somekey: 'a',
                        someotherkey: 'b',
                    })
                )
            ),
            new ResourceModel(
                new Map(
                    Object.entries({
                        somekey: 'c',
                        someotherkey: 'd',
                    })
                )
            ),
        ];
        const event = new ProgressEvent(
            new Map(
                Object.entries({
                    status: OperationStatus.Success,
                    message,
                    resourceModels: models,
                })
            )
        );
        const serialized = event.serialize();
        expect(serialized).toEqual(
            new Map(
                Object.entries({
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
                })
            )
        );
    });

    test('progress event serialize to response with error code', () => {
        const message = 'message of event with error code';
        const event = new ProgressEvent(
            new Map(
                Object.entries({
                    status: OperationStatus.Success,
                    message,
                    errorCode: HandlerErrorCode.InvalidRequest,
                })
            )
        );
        const serialized = event.serialize();
        expect(serialized).toEqual(
            new Map(
                Object.entries({
                    status: OperationStatus.Success,
                    message,
                    errorCode: HandlerErrorCode.InvalidRequest,
                    callbackDelaySeconds: 0,
                })
            )
        );
    });
});
