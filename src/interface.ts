import {
    ClientRequestToken,
    LogicalResourceId,
    NextToken,
} from 'aws-sdk/clients/cloudformation';

export type Optional<T> = T | undefined | null;

export interface Callable<R extends Array<any>, T> {
    (...args: R): T;
}

export enum Action {
    Create = "CREATE",
    Read = "READ",
    Update = "UPDATE",
    Delete = "DELETE",
    List = "LIST",
}

export enum StandardUnit {
    Count = "Count",
    Milliseconds = "Milliseconds",
}

export enum MetricTypes {
    HandlerException = "HandlerException",
    HandlerInvocationCount = "HandlerInvocationCount",
    HandlerInvocationDuration = "HandlerInvocationDuration",
}

export enum OperationStatus {
    Pending = "PENDING",
    InProgress = "IN_PROGRESS",
    Success = "SUCCESS",
    Failed = "FAILED",
}

export enum HandlerErrorCode {
    NotUpdatable = "NotUpdatable",
    InvalidRequest = "InvalidRequest",
    AccessDenied = "AccessDenied",
    InvalidCredentials = "InvalidCredentials",
    AlreadyExists = "AlreadyExists",
    NotFound = "NotFound",
    ResourceConflict = "ResourceConflict",
    Throttling = "Throttling",
    ServiceLimitExceeded = "ServiceLimitExceeded",
    NotStabilized = "NotStabilized",
    GeneralServiceException = "GeneralServiceException",
    ServiceInternalError = "ServiceInternalError",
    NetworkFailure = "NetworkFailure",
    InternalFailure = "InternalFailure",
}

export interface Credentials {
    accessKeyId: string;
    secretAccessKey: string;
    sessionToken: string;
}

export interface RequestContext<CallbackT> {
    invocation: number;
    callbackContext: CallbackT;
    cloudWatchEventsRuleName: string;
    cloudWatchEventsTargetId: string;
}

export interface BaseResourceModel {
    serialize(): Map<string, any>;
    deserialize(): BaseResourceModel;
}

export interface BaseResourceHandlerRequest<T extends BaseResourceModel> {
    clientRequestToken: ClientRequestToken;
    desiredResourceState?: T;
    previousResourceState?: T;
    logicalResourceIdentifier?: LogicalResourceId;
    nextToken?: NextToken;
}

export interface Response<T> {
    bearerToken: string;
    errorCode?: HandlerErrorCode;
    operationStatus: OperationStatus;
    message: string;
    resourceModel?: T;
    resourceModels?: T[];
    nextToken?: NextToken;
}
