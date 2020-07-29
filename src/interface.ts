import 'reflect-metadata';
import {
    ClientRequestToken,
    LogicalResourceId,
    NextToken,
} from 'aws-sdk/clients/cloudformation';
import { classToPlain, Exclude, plainToClass } from 'class-transformer';

export type Optional<T> = T | undefined | null;

export type Dict<T = any> = Record<string, T>;

export interface Callable<R extends Array<any>, T> {
    (...args: R): T;
}

export enum Action {
    Create = 'CREATE',
    Read = 'READ',
    Update = 'UPDATE',
    Delete = 'DELETE',
    List = 'LIST',
}

export enum StandardUnit {
    Count = 'Count',
    Milliseconds = 'Milliseconds',
}

export enum MetricTypes {
    HandlerException = 'HandlerException',
    HandlerInvocationCount = 'HandlerInvocationCount',
    HandlerInvocationDuration = 'HandlerInvocationDuration',
}

export enum OperationStatus {
    Pending = 'PENDING',
    InProgress = 'IN_PROGRESS',
    Success = 'SUCCESS',
    Failed = 'FAILED',
}

export enum HandlerErrorCode {
    NotUpdatable = 'NotUpdatable',
    InvalidRequest = 'InvalidRequest',
    AccessDenied = 'AccessDenied',
    InvalidCredentials = 'InvalidCredentials',
    AlreadyExists = 'AlreadyExists',
    NotFound = 'NotFound',
    ResourceConflict = 'ResourceConflict',
    Throttling = 'Throttling',
    ServiceLimitExceeded = 'ServiceLimitExceeded',
    NotStabilized = 'NotStabilized',
    GeneralServiceException = 'GeneralServiceException',
    ServiceInternalError = 'ServiceInternalError',
    NetworkFailure = 'NetworkFailure',
    InternalFailure = 'InternalFailure',
}

export interface Credentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}

/**
 * Base class for data transfer objects that will contain
 * serialization and deserialization mechanisms.
 */
export abstract class BaseDto {
    constructor(partial?: unknown) {
        if (partial) {
            Object.assign(this, partial);
        }
    }

    @Exclude()
    public serialize(): Dict {
        const data: Dict = classToPlain(this);
        for (const key in data) {
            const value = data[key];
            if (value == null) {
                delete data[key];
            }
        }
        return data;
    }

    public static deserialize<T extends BaseDto>(this: new () => T, jsonData: Dict): T {
        if (jsonData == null) {
            return null;
        }
        return plainToClass(this, jsonData, { enableImplicitConversion: false });
    }

    @Exclude()
    public toJSON(key?: string): Dict {
        return this.serialize();
    }

    @Exclude()
    public toObject(): Dict {
        return this.serialize();
    }
}

export interface RequestContext<T> {
    invocation: number;
    callbackContext: T;
    cloudWatchEventsRuleName: string;
    cloudWatchEventsTargetId: string;
}

export class BaseModel extends BaseDto {
    ['constructor']: typeof BaseModel;

    @Exclude()
    protected static readonly TYPE_NAME?: string;

    @Exclude()
    public getTypeName(): string {
        return Object.getPrototypeOf(this).constructor.TYPE_NAME;
    }
}

export class BaseResourceHandlerRequest<T extends BaseModel> {
    public clientRequestToken: ClientRequestToken;
    public desiredResourceState?: T;
    public previousResourceState?: T;
    public logicalResourceIdentifier?: LogicalResourceId;
    public nextToken?: NextToken;
}

export interface CfnResponse<T extends BaseModel> {
    errorCode?: HandlerErrorCode;
    status: OperationStatus;
    message: string;
    resourceModel?: T;
    resourceModels?: T[];
    nextToken?: NextToken;
}
