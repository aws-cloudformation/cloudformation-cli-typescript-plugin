import {
    ClientRequestToken,
    LogicalResourceId,
    NextToken,
} from 'aws-sdk/clients/cloudformation';
import { allArgsConstructor, builder } from 'tombok';

export type Optional<T> = T | undefined | null;

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

export interface RequestContext<T> {
    invocation: number;
    callbackContext: T;
    cloudWatchEventsRuleName: string;
    cloudWatchEventsTargetId: string;
}

@builder
@allArgsConstructor
export class BaseModel {
    ['constructor']: typeof BaseModel;
    protected static readonly TYPE_NAME?: string;

    constructor(...args: any[]) {}
    public static builder(): any {
        return null;
    }

    public getTypeName(): string {
        return Object.getPrototypeOf(this).constructor.TYPE_NAME;
    }

    public serialize(): Map<string, any> {
        const data: Map<string, any> = new Map<string, any>(Object.entries(this));
        data.forEach((value: any, key: string) => {
            if (value == null) {
                data.delete(key);
            }
        });
        return data;
    }

    public static deserialize(jsonData: any): ThisType<BaseModel> {
        return new this(new Map<string, any>(Object.entries(jsonData)));
    }

    public toObject(): any {
        // @ts-ignore
        const obj = Object.fromEntries(this.serialize().entries());
        return obj;
    }
}

@allArgsConstructor
export class BaseResourceHandlerRequest<T extends BaseModel> {
    public clientRequestToken: ClientRequestToken;
    public desiredResourceState?: T;
    public previousResourceState?: T;
    public logicalResourceIdentifier?: LogicalResourceId;
    public nextToken?: NextToken;

    constructor(...args: any[]) {}
}

export interface CfnResponse<T> {
    bearerToken: string;
    errorCode?: HandlerErrorCode;
    operationStatus: OperationStatus;
    message: string;
    resourceModel?: T;
    resourceModels?: T[];
    nextToken?: NextToken;
}
