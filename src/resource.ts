import 'reflect-metadata';
import { boundMethod } from 'autobind-decorator';

import { ProgressEvent, SessionProxy } from './proxy';
import { BaseHandlerException, InternalFailure, InvalidRequest } from './exceptions';
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
    LambdaLogger,
    LambdaLogPublisher,
    LogFilter,
    LoggerProxy,
    LogPublisher,
    S3LogHelper,
    S3LogPublisher,
} from './log-delivery';
import { MetricsPublisher, MetricsPublisherProxy } from './metrics';
import { deepFreeze, replaceAll } from './utils';
import { exceptions } from '.';

const MUTATING_ACTIONS: [Action, Action, Action] = [
    Action.Create,
    Action.Update,
    Action.Delete,
];

export type HandlerSignature = Callable<
    [Optional<SessionProxy>, any, Dict, Optional<LoggerProxy>],
    Promise<ProgressEvent>
>;
export class HandlerSignatures extends Map<Action, HandlerSignature> {}
class HandlerEvents extends Map<Action, string | symbol> {}

/**
 * Decorates a method to ensure that the JSON input and output are serialized properly.
 *
 * @returns {MethodDecorator}
 */
function ensureSerialize<T extends BaseModel>(toResponse = false): MethodDecorator {
    return function (
        target: BaseResource<T>,
        propertyKey: string,
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
        ): Promise<ProgressEvent | CfnResponse<T>> {
            const progress: ProgressEvent = await originalMethod.apply(this, [
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

export abstract class BaseResource<T extends BaseModel = BaseModel> {
    protected loggerProxy: LoggerProxy;
    protected metricsPublisherProxy: MetricsPublisherProxy;

    // Keep lambda logger as the last fallback log delivery approach
    protected lambdaLogger: LambdaLogger;

    // provider... prefix indicates credential provided by resource owner

    private providerSession: SessionProxy;
    private callerSession: SessionProxy;

    private providerMetricsPublisher: MetricsPublisher;

    private platformLambdaLogger: LogPublisher;
    private cloudWatchLogHelper: CloudWatchLogHelper;
    private s3LogHelper: S3LogHelper;
    private providerEventsLogger: CloudWatchLogPublisher | S3LogPublisher;

    constructor(
        public typeName: string,
        private modelCls: Constructor<T>,
        private handlers?: HandlerSignatures
    ) {
        this.typeName = typeName || '';
        this.handlers = handlers || new HandlerSignatures();

        this.lambdaLogger = console;

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
        awsAccountId?: string
    ): Promise<void> {
        this.loggerProxy = new LoggerProxy();
        this.metricsPublisherProxy = new MetricsPublisherProxy();

        this.platformLambdaLogger = new LambdaLogPublisher(console);
        this.loggerProxy.addLogPublisher(this.platformLambdaLogger);

        // Initialization skipped if dependencies were set during injection (in unit
        // tests).

        // NOTE: providerCredentials and providerLogGroupName are null/not null in
        // sync.
        // Both are required parameters when LoggingConfig (optional) is provided when
        // 'RegisterType'.
        if (providerCredentials) {
            this.providerSession = SessionProxy.getSession(providerCredentials);

            if (!this.providerMetricsPublisher) {
                this.providerMetricsPublisher = new MetricsPublisher(
                    this.providerSession,
                    this.lambdaLogger,
                    resourceType
                );
            }
            this.metricsPublisherProxy.addMetricsPublisher(
                this.providerMetricsPublisher
            );
            this.providerMetricsPublisher.refreshClient();

            if (!this.providerEventsLogger) {
                try {
                    this.cloudWatchLogHelper = new CloudWatchLogHelper(
                        this.providerSession,
                        providerLogGroupName,
                        providerLogStreamName,
                        this.lambdaLogger,
                        this.metricsPublisherProxy
                    );
                    this.cloudWatchLogHelper.refreshClient();
                    this.providerEventsLogger = new CloudWatchLogPublisher(
                        this.providerSession,
                        providerLogGroupName,
                        await this.cloudWatchLogHelper.prepareLogStream(),
                        this.lambdaLogger,
                        this.metricsPublisherProxy
                    );
                } catch (err) {
                    this.log(err);
                    // We will fallback to S3 log publisher.
                    // This will not be work in Production,
                    // because there is no permission to create S3 bucket
                    this.s3LogHelper = new S3LogHelper(
                        this.providerSession,
                        providerLogGroupName,
                        `${providerLogStreamName}-${awsAccountId}`,
                        this.lambdaLogger,
                        this.metricsPublisherProxy
                    );
                    this.s3LogHelper.refreshClient();
                    this.providerEventsLogger = new S3LogPublisher(
                        this.providerSession,
                        providerLogGroupName,
                        await this.s3LogHelper.prepareFolder(),
                        this.lambdaLogger,
                        this.metricsPublisherProxy
                    );
                }
            }
            this.loggerProxy.addLogPublisher(this.providerEventsLogger);
            this.providerEventsLogger.refreshClient();
        }
    }

    private prepareCredentialsFilter(session: SessionProxy): LogFilter {
        const credentials = session?.configuration?.credentials;
        if (credentials) {
            return {
                applyFilter: (message: string): string => {
                    for (const [key, value] of Object.entries(credentials)) {
                        message = replaceAll(message, value, '<REDACTED>');
                    }
                    return message;
                },
            };
        }
        return null;
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
            // Lambda logger is the only fallback if metrics publisher proxy is not
            // initialized.
            this.lambdaLogger.log(err.toString());
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
            this.loggerProxy.log(message, ...optionalParams);
        } else {
            // Lambda logger is the only fallback if metrics publisher proxy is not
            // initialized.
            this.lambdaLogger.log(message, ...optionalParams);
        }
    }

    public addHandler = (action: Action, f: HandlerSignature): HandlerSignature => {
        this.handlers.set(action, f);
        return f;
    };

    private invokeHandler = async (
        session: Optional<SessionProxy>,
        request: BaseResourceHandlerRequest<T>,
        action: Action,
        callbackContext: Dict
    ): Promise<ProgressEvent> => {
        const handle: HandlerSignature = this.handlers.get(action);
        if (!handle) {
            return ProgressEvent.failed(
                HandlerErrorCode.InternalFailure,
                `No handler for ${action}`
            );
        }
        // We will make the callback context and resource states readonly
        // to avoid modification at a later time
        deepFreeze(callbackContext);
        deepFreeze(request);
        const progress = await handle(
            session,
            request,
            callbackContext,
            this.loggerProxy
        );
        const isInProgress = progress.status === OperationStatus.InProgress;
        const isMutable = MUTATING_ACTIONS.some((x) => x === action);
        if (isInProgress && !isMutable) {
            throw new InternalFailure(
                'READ and LIST handlers must return synchronously.'
            );
        }
        return progress;
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
                this.modelCls
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
        context: any
    ): Promise<ProgressEvent>;
    @boundMethod
    @ensureSerialize<T>()
    public async testEntrypoint(eventData: Dict, context: any): Promise<ProgressEvent> {
        let msg = 'Uninitialized';
        let progress: ProgressEvent;
        try {
            if (!this.modelCls) {
                throw new exceptions.InternalFailure(
                    'Missing Model class to be used to deserialize JSON data.'
                );
            }
            this.loggerProxy = new LoggerProxy();
            this.loggerProxy.addLogPublisher(new LambdaLogPublisher(console));
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
                progress = err.toProgressEvent();
            } else {
                this.log(`Exception caught: ${err.message}`, err);
                msg = err.message || msg;
                progress = ProgressEvent.failed(HandlerErrorCode.InternalFailure, msg);
            }
        }
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
            return unmodeled.toModeled<T>(this.modelCls);
        } catch (err) {
            this.log('Invalid request');
            throw new InvalidRequest(`${err} (${err.name})`);
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
    ): Promise<ProgressEvent> {
        let progress: ProgressEvent;
        let bearerToken: string;
        try {
            if (!this.modelCls) {
                throw new exceptions.InternalFailure(
                    'Missing Model class to be used to deserialize JSON data.'
                );
            }
            const [credentials, action, callback, event] = BaseResource.parseRequest(
                eventData
            );
            bearerToken = event.bearerToken;
            const [callerCredentials, providerCredentials] = credentials;
            const request = this.castResourceRequest(event);

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
                event.awsAccountId
            );
            this.log('entrypoint event data', eventData);

            const startTime = new Date(Date.now());
            await this.metricsPublisherProxy.publishInvocationMetric(startTime, action);
            let error: Error;
            try {
                // last mile proxy creation with passed-in credentials (unless we are operating
                // in a non-AWS model)
                if (callerCredentials) {
                    this.callerSession = SessionProxy.getSession(callerCredentials);
                }
                progress = await this.invokeHandler(
                    this.callerSession,
                    request,
                    action,
                    callback
                );
            } catch (err) {
                error = err;
            }
            const endTime = new Date(Date.now());
            const milliseconds: number = endTime.getTime() - startTime.getTime();
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
                progress = err.toProgressEvent();
            } else {
                this.log(`Exception caught: ${err.message}`, err);
                progress = ProgressEvent.failed(
                    HandlerErrorCode.InternalFailure,
                    err.message
                );
            }
        }
        if (this.loggerProxy) {
            // Filters to scrub sensitive info from logs
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
            await this.loggerProxy.processQueue();
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
