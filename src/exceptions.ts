import { BaseModel, HandlerErrorCode } from './interface';
import { ProgressEvent } from './proxy';

export abstract class BaseHandlerException extends Error {
    static serialVersionUID = -1646136434112354328;

    public errorCode: HandlerErrorCode;

    public constructor(message?: any, errorCode?: HandlerErrorCode) {
        super(message);
        this.errorCode =
            errorCode || HandlerErrorCode[this.constructor.name as HandlerErrorCode];
        Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain
    }

    public toProgressEvent<T extends BaseModel = BaseModel>(): ProgressEvent<T> {
        return ProgressEvent.failed<ProgressEvent<T>>(this.errorCode, this.toString());
    }
}

export class NotUpdatable extends BaseHandlerException {}

export class InvalidRequest extends BaseHandlerException {}

export class InvalidTypeConfiguration extends BaseHandlerException {
    constructor(typeName: string, reason: string) {
        super(
            `Invalid TypeConfiguration provided for type '${typeName}'. Reason: ${reason}`,
            HandlerErrorCode.InvalidTypeConfiguration
        );
    }
}

export class AccessDenied extends BaseHandlerException {}

export class InvalidCredentials extends BaseHandlerException {}

export class AlreadyExists extends BaseHandlerException {
    constructor(typeName: string, identifier: string) {
        super(
            `Resource of type '${typeName}' with identifier '${identifier}' already exists.`
        );
    }
}

export class NotFound extends BaseHandlerException {
    constructor(typeName: string, identifier: string) {
        super(
            `Resource of type '${typeName}' with identifier '${identifier}' was not found.`
        );
    }
}

export class ResourceConflict extends BaseHandlerException {}

export class Throttling extends BaseHandlerException {}

export class ServiceLimitExceeded extends BaseHandlerException {}

export class NotStabilized extends BaseHandlerException {}

export class GeneralServiceException extends BaseHandlerException {}

export class ServiceInternalError extends BaseHandlerException {}

export class NetworkFailure extends BaseHandlerException {}

export class InternalFailure extends BaseHandlerException {}
