import * as exceptions from '../../src/exceptions';
import { HandlerErrorCode, OperationStatus } from '../../src/interface';

describe('when getting exceptions', () => {
    test('all error codes have exceptions', () => {
        expect(exceptions.BaseHandlerException).toBeDefined();
        for (let errorCode in HandlerErrorCode) {
            expect(exceptions[errorCode].prototype).toBeInstanceOf(exceptions.BaseHandlerException);
        }
    });

    test('exception to progress event', () => {
        for (let errorCode in HandlerErrorCode) {
            let e: exceptions.BaseHandlerException;
            try {
                e = new exceptions[errorCode]();
            } catch(err) {
                e = new exceptions[errorCode]('Foo::Bar::Baz', 'ident');
            }
            const progressEvent = e.toProgressEvent();
            expect(progressEvent.status).toBe(OperationStatus.Failed);
            expect(progressEvent.errorCode).toBe(HandlerErrorCode[errorCode]);
        }
    });
});
