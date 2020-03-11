import { ProgressEvent, SessionProxy } from '../../src/proxy';
import { Credentials, HandlerErrorCode, OperationStatus } from '../../src/interface';

describe('when getting session proxy', () => {
    test('get session returns proxy', () => {
        const proxy = SessionProxy.getSession({
            accessKeyId: '',
            secretAccessKey: '',
            sessionToken: '',
        } as Credentials);
        expect(proxy).toBeInstanceOf(SessionProxy);
    });
    
    test('get session returns null', () => {
        const proxy = SessionProxy.getSession(null);
        expect(proxy).toBeNull();
    });

    test('progress event failed is json serializable', () => {
        const errorCode = HandlerErrorCode.AlreadyExists;
        const message = 'message of failed event';
        const event = ProgressEvent.failed(errorCode, message);
        expect(JSON.parse(JSON.stringify(event.serialize()))).toEqual({
            status: OperationStatus.Failed,
            errorCode: errorCode,
            message: message,
            // callbackDelaySeconds: 0,
        });
    });
});
