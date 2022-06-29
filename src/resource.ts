import 'reflect-metadata';
import { boundMethod } from 'autobind-decorator';

import { AwsTaskWorkerPool, ProgressEvent, SessionProxy } from './proxy';
import {
    BaseHandlerException,
    InternalFailure,
    InvalidRequest,
    InvalidTypeConfiguration,
} from './exceptions';
import {
    Action,
    BaseModel,
    BaseResourceHandlerRequest,
    Callable,
    CfnResponse,
    Constructor,
    Credentials,
    Dict,
    HandlerErrorCode,
    HandlerRequest,
    LambdaContext,
    OperationStatus,
    Optional,
    TestEvent,
    UnmodeledRequest,
} from './interface';
import {
    CloudWatchLogHelper,
    CloudWatchLogPublisher,
    LambdaLogPublisher,
    LogFilter,
    Logger,
    LoggerProxy,
    LogPublisher,
    S3LogHelper,
    S3LogPublisher,
} from './log-delivery';
import { MetricsPublisher, MetricsPublisherProxy } from './metrics';
import { deepFreeze, delay, replaceAll } from './utils';

const MUTATING_ACTIONS: [Action, Action, Action] = [
    Action.Create,
    Action.Update,
    Action.Delete,
];

export type HandlerSignature<T extends BaseModel, TC extends BaseModel> = Callable<
    [Optional<SessionProxy>, any, Dict, TC, LoggerProxy],
    Promise<ProgressEvent<T>>
>;
export class HandlerSignatures<T extends BaseModel, TC extends BaseModel> extends Map<
    Action,
    HandlerSignature<T, TC>
> {}
class HandlerEvents extends Map<Action, string | symbol> {}

/**
 * Decorates a method to ensure that the JSON input and output are serialized properly.
 *
 * @returns {MethodDecorator}
 */
function ensureSerialize<T extends BaseModel>(toResponse = false): MethodDecorator {
    return function (
        target: Object,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor
    ): PropertyDescriptor {
        // Save a reference to the original method this way we keep the values currently in the
        // descriptor and don't overwrite what another decorator might have done to the descriptor.
        if (descriptor === undefined) {
            descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
        }
        const originalMethod = descriptor.value;
        // Wrapping the original method with new signature.
        descriptor.value = async function (
            event: any | Dict,
            context: any
        ): Promise<ProgressEvent<T> | CfnResponse<T>> {
            const progress: ProgressEvent<T> = await originalMethod.apply(this, [
                event,
                context,
            ]);
            if (toResponse) {
                // Use the raw event data as a last-ditch attempt to call back if the
                // request is invalid.
                const serialized = progress.serialize();
                return Promise.resolve(serialized as CfnResponse<T>);
            }
            return Promise.resolve(progress);
        };
        return descriptor;
    };
}

export abstract class BaseResource<
    T extends BaseModel = BaseModel,
    TC extends BaseModel = BaseModel
> {
    protected loggerProxy: LoggerProxy;
    protected metricsPublisherProxy: MetricsPublisherProxy;

    // Keep platform logger as the last fallback log delivery approach
    protected lambdaLogger: Logger;
    protected platformLoggerProxy: LoggerProxy;
    private platformLambdaLogger: LogPublisher;

    // provider... prefix indicates credential provided by resource owner

    private providerSession: SessionProxy;
    private callerSession: SessionProxy;

    private providerMetricsPublisher: MetricsPublisher;

    private cloudWatchLogHelper: CloudWatchLogHelper;
    private s3LogHelper: S3LogHelper;
    private providerEventsLogger: CloudWatchLogPublisher | S3LogPublisher;

    constructor(
        public readonly typeName: string,
        public readonly modelTypeReference: Constructor<T>,
        public readonly typeConfigurationTypeReference: Constructor<TC> & {
            deserialize: Function;
        },
        protected readonly workerPool?: AwsTaskWorkerPool,
        private handlers?: HandlerSignatures<T, TC>
    ) {
        this.typeName = typeName || '';
        this.handlers = handlers || new HandlerSignatures<T, TC>();

        this.lambdaLogger = console;
        this.platformLoggerProxy = new LoggerProxy();
        this.platformLambdaLogger = new LambdaLogPublisher(this.lambdaLogger);
        this.platformLoggerProxy.addLogPublisher(this.platformLambdaLogger);

        const actions: HandlerEvents =
            Reflect.getMetadata('handlerEvents', this) || new HandlerEvents();
        actions.forEach((value: string | symbol, key: Action) => {
            this.addHandler(key, (this as any)[value]);
        });
    }

    /**
     * This function initializes dependencies which are depending on credentials
     * passed at function invoke and not available during construction
     */
    private async initializeRuntime(
        resourceType: string,
        providerCredentials: Credentials,
        providerLogGroupName: string,
        providerLogStreamName?: string,
        region?: string,
        awsAccountId?: string
    ): Promise<void> {
        this.loggerProxy = new LoggerProxy();
        this.metricsPublisherProxy = new MetricsPublisherProxy();
        this.loggerProxy.addLogPublisher(this.platformLambdaLogger);

        // Initialization skipped if dependencies were set during injection (in unit tests).

        // NOTE: providerCredentials and providerLogGroupName are null/not null in sync.
        // Both are required parameters when LoggingConfig (optional) is provided when
        // 'RegisterType'.
        if (providerCredentials) {
            this.providerSession = SessionProxy.getSession(providerCredentials, region);

            this.providerMetricsPublisher = new MetricsPublisher(
                this.providerSession,
                this.platformLoggerProxy,
                resourceType,
                this.workerPool
            );
            this.metricsPublisherProxy.addMetricsPublisher(
                this.providerMetricsPublisher
            );
            this.providerMetricsPublisher.refreshClient();

            // We will fallback to S3 log publisher.
            // This will not work in Production, because
            // there is no permission to create S3 bucket.
            const logGroupName = `${providerLogGroupName}-${awsAccountId}`;
            this.s3LogHelper = new S3LogHelper(
                this.providerSession,
                logGroupName,
                providerLogStreamName,
                this.platformLoggerProxy,
                this.metricsPublisherProxy,
                this.workerPool
            );
            this.s3LogHelper.refreshClient();
            const folderName = await this.s3LogHelper.prepareFolder();
            let providerS3Logger = null;
            if (folderName) {
                providerS3Logger = new S3LogPublisher(
                    this.providerSession,
                    logGroupName,
                    folderName,
                    this.platformLoggerProxy,
                    this.metricsPublisherProxy,
                    this.workerPool
                );
                this.loggerProxy.addLogPublisher(providerS3Logger);
                providerS3Logger.refreshClient();
            }
            try {
                this.cloudWatchLogHelper = new CloudWatchLogHelper(
                    this.providerSession,
                    providerLogGroupName,
                    providerLogStreamName,
                    this.platformLoggerProxy,
                    this.metricsPublisherProxy,
                    this.workerPool
                );
                this.cloudWatchLogHelper.refreshClient();
                const logStreamName = await this.cloudWatchLogHelper.prepareLogStream();
                if (!logStreamName) {
                    throw new Error('Unable to setup CloudWatch logs.');
                }
                this.providerEventsLogger = new CloudWatchLogPublisher(
                    this.providerSession,
                    providerLogGroupName,
                    logStreamName,
                    this.platformLoggerProxy,
                    this.metricsPublisherProxy,
                    this.workerPool
                );
                this.loggerProxy.addLogPublisher(this.providerEventsLogger);
                this.providerEventsLogger.refreshClient();
                await this.providerEventsLogger.populateSequenceToken();
            } catch (err) {
                this.log(err);
                this.providerEventsLogger = providerS3Logger;
            }
        }
    }

    private prepareCredentialsFilter(session: SessionProxy): LogFilter {
        const credentials = session?.configuration?.credentials;
        if (credentials) {
            return {
                applyFilter: (message: string): string => {
                    for (const value of Object.values(credentials)) {
                        message = replaceAll(message, value, '<REDACTED>');
                    }
                    return message;
                },
            };
        }
        return null;
    }

    private async waitRunningProcesses() {
        this.log('Waiting for logger proxy processes to finish...');
        if (this.workerPool) {
            this.log(
                `Prepare worker pool for shutdown.\tNumber of completed tasks: ${this.workerPool.completed}\tLength of time since instance was created: ${this.workerPool.duration} ms`
            );
        }
        await delay(1);
        if (this.loggerProxy) {
            await this.loggerProxy.waitCompletion();
        }
        await this.platformLoggerProxy.waitCompletion();
        console.debug('Log delivery completed.');
        if (this.workerPool) {
            await this.workerPool.shutdown();
        }
    }

    /*
     * null-safe exception metrics delivery
     */
    private async publishExceptionMetric(action: Action, err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishExceptionMetric(
                new Date(Date.now()),
                action,
                err
            );
        } else {
            // The platform logger's is the only fallback if metrics publisher proxy is not
            // initialized.
            this.platformLoggerProxy.tracker.done = false;
            this.platformLoggerProxy.log(err.toString());
        }
    }

    /**
     * null-safe logger redirect
     *
     * @param message The primary message.
     * @param optionalParams All additional parameters used as substitution values.
     */
    private log(message?: any, ...optionalParams: any[]): void {
        if (this.loggerProxy) {
            this.loggerProxy.tracker.done = false;
            this.loggerProxy.log(message, ...optionalParams);
        } else {
            // The platform logger's is the only fallback if metrics publisher proxy is not
            // initialized.
            this.platformLoggerProxy.tracker.done = false;
            this.platformLoggerProxy.log(message, ...optionalParams);
        }
    }

    public addHandler = (
        action: Action,
        f: HandlerSignature<T, TC>
    ): HandlerSignature<T, TC> => {
        this.handlers.set(action, f);
        return f;
    };

    private invokeHandler = async (
        session: Optional<SessionProxy>,
        request: BaseResourceHandlerRequest<T>,
        action: Action,
        callbackContext: Dict,
        typeConfiguration?: TC
    ): Promise<ProgressEvent<T>> => {
        const actionName = action == null ? '<null>' : action.toString();
        if (!this.handlers.has(action)) {
            throw new Error(`Unknown action ${actionName}`);
        }
        const handleRequest: HandlerSignature<T, TC> = this.handlers.get(action);
        // We will make the callback context and resource states readonly
        // to avoid modification at a later time
        deepFreeze(callbackContext);
        deepFreeze(request);
        this.log(`[${action}] invoking handler...`);
        const handlerResponse = await handleRequest(
            session,
            request,
            callbackContext,
            typeConfiguration,
            this.loggerProxy || this.platformLoggerProxy
        );
        this.log(`[${action}] handler invoked`);
        if (handlerResponse != null) {
            this.log('Handler returned %s', handlerResponse.status);
        } else {
            this.log('Handler returned null');
            throw new Error('Handler failed to provide a response.');
        }
        const isInProgress = handlerResponse.status === OperationStatus.InProgress;
        const isMutable = MUTATING_ACTIONS.some((x) => x === action);
        if (isInProgress && !isMutable) {
            throw new InternalFailure(
                'READ and LIST handlers must return synchronously.'
            );
        }
        return handlerResponse;
    };

    private parseTestRequest = (
        eventData: Dict
    ): [BaseResourceHandlerRequest<T>, Action, Dict] => {
        let request: BaseResourceHandlerRequest<T>;
        let action: Action;
        let event: TestEvent;
        let callbackContext: Dict;
        try {
            event = TestEvent.deserialize(eventData);
            const creds = event.credentials as Credentials;
            if (!creds) {
                throw new Error(
                    'Event data is missing required property "credentials".'
                );
            }
            request = UnmodeledRequest.deserialize(event.request).toModeled<T>(
                this.modelTypeReference
            );

            this.callerSession = SessionProxy.getSession(creds, event.region);
            action = event.action;
            callbackContext = event.callbackContext || {};
        } catch (err) {
            this.log('Invalid request');
            throw new InternalFailure(`${err} (${err.name})`);
        }

        return [request, action, callbackContext];
    };

    // @ts-ignore
    public async testEntrypoint(
        eventData: any | Dict,
        context?: Partial<LambdaContext>
    ): Promise<ProgressEvent<T>>;
    @boundMethod
    @ensureSerialize<T>()
    public async testEntrypoint(
        eventData: Dict,
        context?: Partial<LambdaContext>
    ): Promise<ProgressEvent<T>> {
        let msg = 'Uninitialized';
        let progress: ProgressEvent<T>;
        try {
            if (!this.modelTypeReference) {
                throw new InternalFailure(
                    'Missing Model class to be used to deserialize JSON data.'
                );
            }
            this.log(
                `START RequestId: ${context?.awsRequestId} Version: ${context?.functionVersion}`
            );
            this.log('EVENT DATA\n', eventData);
            const [request, action, callbackContext] = this.parseTestRequest(eventData);
            progress = await this.invokeHandler(
                this.callerSession,
                request,
                action,
                callbackContext
            );
        } catch (err) {
            if (!err.stack) {
                Error.captureStackTrace(err);
            }
            err.stack = `${new Error().stack}\n${err.stack}`;
            if (err instanceof BaseHandlerException) {
                this.log(`Handler error: ${err.message}`, err);
                progress = err.toProgressEvent<T>();
            } else {
                this.log(`Exception caught: ${err.message}`, err);
                msg = err.message || msg;
                progress = ProgressEvent.failed<ProgressEvent<T>>(
                    HandlerErrorCode.InternalFailure,
                    msg
                );
            }
        }
        this.log(`END RequestId: ${context?.awsRequestId}`);
        await this.waitRunningProcesses();
        return Promise.resolve(progress);
    }

    private static parseRequest = (
        eventData: Dict
    ): [[Optional<Credentials>, Credentials], Action, Dict, HandlerRequest] => {
        let callerCredentials: Optional<Credentials>;
        let providerCredentials: Credentials;
        let action: Action;
        let callbackContext: Dict;
        let event: HandlerRequest;
        try {
            event = HandlerRequest.deserialize(eventData);
            if (!event.awsAccountId) {
                throw new Error(
                    'Event data is missing required property "awsAccountId".'
                );
            }
            callerCredentials = event.requestData.callerCredentials;
            providerCredentials = event.requestData.providerCredentials;
            action = event.action;
            callbackContext = event.callbackContext || {};
        } catch (err) {
            throw new InvalidRequest(`${err} (${err.name})`);
        }
        return [
            [callerCredentials, providerCredentials],
            action,
            callbackContext,
            event,
        ];
    };

    private castResourceRequest = (
        request: HandlerRequest
    ): BaseResourceHandlerRequest<T> => {
        try {
            const unmodeled: UnmodeledRequest = UnmodeledRequest.fromUnmodeled({
                clientRequestToken: request.bearerToken,
                desiredResourceState: request.requestData.resourceProperties,
                previousResourceState: request.requestData.previousResourceProperties,
                desiredResourceTags: request.requestData.stackTags,
                previousResourceTags: request.requestData.previousStackTags,
                systemTags: request.requestData.systemTags,
                awsAccountId: request.awsAccountId,
                logicalResourceIdentifier: request.requestData.logicalResourceId,
                region: request.region,
            });
            return unmodeled.toModeled<T>(this.modelTypeReference);
        } catch (err) {
            this.log('Invalid request');
            throw new InvalidRequest(`${err} (${err.name})`);
        }
    };

    private castTypeConfigurationRequest = (request: HandlerRequest): TC => {
        try {
            return this.typeConfigurationTypeReference.deserialize(
                request.requestData.typeConfiguration
            );
        } catch (err) {
            this.log('Invalid Type Configuration');
            throw new InvalidTypeConfiguration(this.typeName, `${err} (${err.name}`);
        }
    };

    // @ts-ignore
    public async entrypoint(
        eventData: any | Dict,
        context: LambdaContext
    ): Promise<CfnResponse<T>>;
    @boundMethod
    @ensureSerialize<T>(true)
    public async entrypoint(
        eventData: Dict,
        context: LambdaContext
    ): Promise<ProgressEvent<T>> {
        let progress: ProgressEvent<T>;
        let bearerToken: string;
        let milliseconds: number = null;
        try {
            if (!this.modelTypeReference) {
                throw new InternalFailure(
                    'Missing Model class to be used to deserialize JSON data.'
                );
            }
            const [credentials, action, callback, event] = BaseResource.parseRequest(
                eventData
            );
            bearerToken = event.bearerToken;
            const [callerCredentials, providerCredentials] = credentials;
            const request = this.castResourceRequest(event);

            const typeConfiguration = this.castTypeConfigurationRequest(event);

            let streamName = `${event.awsAccountId}-${event.region}`;
            if (event.stackId && request.logicalResourceIdentifier) {
                streamName = `${event.stackId}/${request.logicalResourceIdentifier}`;
            }

            // initialize dependencies
            await this.initializeRuntime(
                event.resourceType || this.typeName,
                providerCredentials,
                event.requestData?.providerLogGroupName,
                streamName,
                event.region,
                event.awsAccountId
            );
            this.log(
                `START RequestId: ${context?.awsRequestId} Version: ${context?.functionVersion}`
            );

            const startTime = new Date(Date.now());
            await this.metricsPublisherProxy.publishInvocationMetric(startTime, action);
            let error: Error;
            try {
                // Last mile proxy creation with passed-in credentials (unless we are operating
                // in a non-AWS model)
                if (callerCredentials) {
                    this.callerSession = SessionProxy.getSession(
                        callerCredentials,
                        event.region
                    );
                }
                // Filters to scrub sensitive info from logs.
                // It needs to be placed after all credentials have been loaded.
                if (this.loggerProxy) {
                    this.loggerProxy.addFilter({
                        applyFilter: (message: string): string => {
                            return replaceAll(message, bearerToken, '<REDACTED>');
                        },
                    });
                    this.loggerProxy.addFilter(
                        this.prepareCredentialsFilter(this.providerSession)
                    );
                    this.loggerProxy.addFilter(
                        this.prepareCredentialsFilter(this.callerSession)
                    );
                }
                this.log('EVENT DATA\n', eventData);
                progress = await this.invokeHandler(
                    this.callerSession,
                    request,
                    action,
                    callback,
                    typeConfiguration
                );
            } catch (err) {
                error = err;
            }
            const endTime = new Date(Date.now());
            milliseconds = endTime.getTime() - startTime.getTime();
            await this.metricsPublisherProxy.publishDurationMetric(
                endTime,
                action,
                milliseconds
            );
            if (error) {
                await this.publishExceptionMetric(action, error);
                throw error;
            }
        } catch (err) {
            if (!err.stack) {
                Error.captureStackTrace(err);
            }
            err.stack = `${new Error().stack}\n${err.stack}`;
            if (err instanceof BaseHandlerException) {
                this.log(`Handler error: ${err.message}`, err);
                progress = err.toProgressEvent<T>();
            } else {
                this.log(`Exception caught: ${err.message}`, err);
                progress = ProgressEvent.failed<ProgressEvent<T>>(
                    HandlerErrorCode.InternalFailure,
                    err.message
                );
            }
        }
        this.log(`END RequestId: ${context?.awsRequestId}`);
        this.log(
            `REPORT RequestId: ${context?.awsRequestId}\tDuration: ${milliseconds} ms\tMemory Size: ${context?.memoryLimitInMB} MB`
        );
        try {
            await this.waitRunningProcesses();
        } catch (err) {
            this.lambdaLogger.log(err);
            await delay(2);
            /* TODO: Check if the real remaining time from CloudFormation can be calculated
            // Wait for as long as possible (basically until the end of the lambda process)
            const remainingTime = context ? context.getRemainingTimeInMillis() : 0;
            if (remainingTime > 200) {
                await delay((remainingTime - 200) / 100);
            } */
        }
        return progress;
    }
}

/**
 * Decorates a method to point to the proper action
 *
 * @returns {MethodDecorator}
 */
export function handlerEvent(action: Action): MethodDecorator {
    return function (
        target: any,
        propertyKey: string | symbol,
        descriptor: PropertyDescriptor
    ): PropertyDescriptor {
        if (target instanceof BaseResource) {
            const actions: HandlerEvents =
                Reflect.getMetadata('handlerEvents', target) || new HandlerEvents();
            if (!actions.has(action)) {
                actions.set(action, propertyKey);
            }
            Reflect.defineMetadata('handlerEvents', actions, target);
        }
        if (descriptor) {
            // The event handler decorated methods need binding
            const boundDescriptor = boundMethod(target, propertyKey, descriptor);
            if (typeof descriptor.value === 'function' && boundDescriptor) {
                return boundDescriptor;
            }
            return descriptor;
        }
    };
}
