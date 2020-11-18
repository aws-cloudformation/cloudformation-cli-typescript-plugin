import * as exceptions from '../../src/exceptions';
import { HandlerErrorCode, OperationStatus } from '../../src/interface';

type Exceptions = keyof typeof exceptions;

describe('when getting exceptions', () => {
    test('all error codes have exceptions', () => {
        expect(exceptions.BaseHandlerException).toBeDefined();
        for (const errorCode in HandlerErrorCode) {
            const exceptionName = errorCode as Exceptions;
            expect(exceptions[exceptionName].prototype).toBeInstanceOf(
                exceptions.BaseHandlerException
            );
        }
    });

    test('exception to progress event', () => {
        for (const errorCode in HandlerErrorCode) {
            const exceptionName = errorCode as Exceptions;
            let e: exceptions.BaseHandlerException;
            try {
                e = new exceptions[exceptionName](null, null);
            } catch (err) {
                e = new exceptions[exceptionName](
                    'Foo::Bar::Baz',
                    errorCode as HandlerErrorCode
                );
            }
            const progressEvent = e.toProgressEvent();
            expect(progressEvent.status).toBe(OperationStatus.Failed);
            expect(progressEvent.errorCode).toBe(
                HandlerErrorCode[errorCode as HandlerErrorCode]
            );
        }
    });
});
