import { ProgressEvent, SessionProxy } from '../../src/proxy';
import {
    BaseModel,
    Credentials,
    HandlerErrorCode,
    OperationStatus,
    Optional,
} from '../../src/interface';

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
        expect(serialized).toMatchObject({
            status: OperationStatus.Failed,
            errorCode: errorCode,
            message,
            callbackDelaySeconds: 0,
        });
    });

    test('progress event serialize to response with context', () => {
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

    test('progress event serialize to response with model', () => {
        const message = 'message of event with model';
        const model = new ResourceModel({
            somekey: 'a',
            someotherkey: 'b',
            somenullkey: null,
        });
        const event = new ProgressEvent({
            status: OperationStatus.Success,
            message: message,
            resourceModel: model,
        });
        const serialized = event.serialize();
        expect(serialized).toMatchObject({
            status: OperationStatus.Success,
            message,
            resourceModel: {
                somekey: 'a',
                someotherkey: 'b',
            },
            callbackDelaySeconds: 0,
        });
    });

    test('progress event serialize to response with models', () => {
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
        const event = new ProgressEvent({
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

    test('progress event serialize to response with error code', () => {
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
