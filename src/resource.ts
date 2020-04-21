import 'reflect-metadata';
import { boundMethod } from 'autobind-decorator';

import { ProgressEvent, SessionProxy } from './proxy';
import { reportProgress } from './callback';
import { BaseHandlerException, InternalFailure, InvalidRequest } from './exceptions';
import {
    Action,
    BaseResourceModel,
    BaseResourceHandlerRequest,
    Callable,
    CfnResponse,
    Credentials,
    HandlerErrorCode,
    OperationStatus,
    Optional,
    RequestContext,
} from './interface';
import { ProviderLogHandler } from './log-delivery';
import { MetricsPublisherProxy } from './metrics';
import { cleanupCloudwatchEvents, rescheduleAfterMinutes } from './scheduler';
import {
    delay,
    Constructor,
    HandlerRequest,
    LambdaContext,
    TestEvent,
    UnmodeledRequest,
} from './utils';

const LOGGER = console;
const MUTATING_ACTIONS: [Action, Action, Action] = [Action.Create, Action.Update, Action.Delete];
const INVOCATION_TIMEOUT_MS = 60000;

export type HandlerSignature = Callable<[Optional<SessionProxy>, any, Map<string, any>], Promise<ProgressEvent>>;
export class HandlerSignatures extends Map<Action, HandlerSignature> {};
class HandlerEvents extends Map<Action, string | symbol> {};

/**
 * Decorates a method to ensure that the JSON input and output are serialized properly.
 *
 * @returns {MethodDecorator}
 */
function ensureSerialize(toResponse: boolean = false): MethodDecorator {
    return function(target: any, propertyKey: string, descriptor: PropertyDescriptor): PropertyDescriptor {
        type Resource = typeof target;
        // Save a reference to the original method this way we keep the values currently in the
        // descriptor and don't overwrite what another decorator might have done to the descriptor.
        if(descriptor === undefined) {
            descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
        }
        const originalMethod = descriptor.value;
        // Wrapping the original method with new signature.
        descriptor.value = async function(event: Object | Map<string, any>, context: any): Promise<ProgressEvent | CfnResponse<Resource>> {
            let mappedEvent: Map<string, any>;
            if (event instanceof Map) {
                mappedEvent = new Map<string, any>(event);
            } else {
                mappedEvent = new Map<string, any>(Object.entries(event));
            }
            const progress: ProgressEvent = await originalMethod.apply(this, [mappedEvent, context]);
            if (toResponse) {
                // Use the raw event data as a last-ditch attempt to call back if the
                // request is invalid.
                const serialized = progress.serialize(true, mappedEvent.get('bearerToken'));
                return Promise.resolve(serialized.toObject() as CfnResponse<Resource>);
            }
            return Promise.resolve(progress);
        }
        return descriptor;
    }
}

/**
 * Decorates a method to point to the proper action
 *
 * @returns {MethodDecorator}
 */
export function handlerEvent(action: Action): MethodDecorator {
    return function(target: any, propertyKey: string | symbol, descriptor: PropertyDescriptor): PropertyDescriptor {
        if (target instanceof BaseResource) {
            const actions: HandlerEvents = Reflect.getMetadata('handlerEvents', target) || new HandlerEvents();
            if (!actions.has(action)) {
                actions.set(action, propertyKey);
            }
            Reflect.defineMetadata('handlerEvents', actions, target);
        }
        if (descriptor) {
            return descriptor;
        }
    }
}

export abstract class BaseResource<T extends BaseResourceModel = BaseResourceModel> {
    constructor(
        public typeName: string,
        private modelCls: Constructor<T>,
        private handlers?: HandlerSignatures,
    ) {
        this.typeName = typeName || '';
        this.handlers = handlers || new HandlerSignatures();
        const actions: HandlerEvents = Reflect.getMetadata('handlerEvents', this) || new HandlerEvents();
        actions.forEach((value: string | symbol, key: Action) => {
            this.addHandler(key, (this as any)[value]);
        });
    }

    public addHandler = (action: Action, f: HandlerSignature): HandlerSignature => {
        this.handlers.set(action, f);
        return f;
    }

    public static scheduleReinvocation = async (
        handlerRequest: HandlerRequest,
        handlerResponse: ProgressEvent,
        context: LambdaContext,
        session: SessionProxy,
    ): Promise<boolean> => {
        if (handlerResponse.status !== OperationStatus.InProgress) {
            return false;
        }
        // Modify requestContext in-place, so that invoke count is bumped on local
        // reinvoke too.
        const reinvokeContext: RequestContext<Map<string, any>> = handlerRequest.requestContext;
        reinvokeContext.invocation = (reinvokeContext.invocation || 0) + 1;
        const callbackDelaySeconds = handlerResponse.callbackDelaySeconds;
        const remainingMs = context.getRemainingTimeInMillis();

        // When a handler requests a sub-minute callback delay, and if the lambda
        // invocation has enough runtime (with 20% buffer), we can re-run the handler
        // locally otherwise we re-invoke through CloudWatchEvents.
        const neededMsRemaining = callbackDelaySeconds * 1200 + INVOCATION_TIMEOUT_MS;
        if (callbackDelaySeconds < 60 && remainingMs > neededMsRemaining) {
            await delay(callbackDelaySeconds);
            return true;
        }
        const callbackDelayMin = Number(callbackDelaySeconds / 60);
        await rescheduleAfterMinutes(
            session,
            context.invokedFunctionArn,
            callbackDelayMin,
            handlerRequest,
        );
        return false;
    }

    private invokeHandler = async (
        session: Optional<SessionProxy>,
        request: BaseResourceHandlerRequest<T>,
        action: Action,
        callbackContext: Map<string, any>,
    ): Promise<ProgressEvent> => {
        const handle: HandlerSignature = this.handlers.get(action);
        if (!handle) {
            return ProgressEvent.failed(
                HandlerErrorCode.InternalFailure, `No handler for ${action}`
            );
        }
        const progress = await handle(session, request, callbackContext);
        const isInProgress = progress.status === OperationStatus.InProgress;
        const isMutable = MUTATING_ACTIONS.some(x => x === action);
        if (isInProgress && !isMutable) {
            throw new InternalFailure('READ and LIST handlers must return synchronously.');
        }
        return progress;
    }

    private parseTestRequest = (
        eventData: Map<string, any>
    ): [
        Optional<SessionProxy>,
        BaseResourceHandlerRequest<T>,
        Action,
        Map<string, any>,
    ] => {
        let session: SessionProxy;
        let request: BaseResourceHandlerRequest<T>;
        let action: Action;
        let event: TestEvent;
        try {
            event = new TestEvent(eventData);
            const creds = event.credentials as Credentials;
            if (!creds) {
                throw new Error('Event data is missing required property "credentials".')
            }
            if (!this.modelCls) {
                throw new Error('Missing Model class to be used to deserialize JSON data.')
            }
            if (event.request instanceof Map) {
                event.request = new Map<string, any>(event.request);
            } else {
                event.request = new Map<string, any>(Object.entries(event.request));
            }
            request = new UnmodeledRequest(event.request).toModeled<T>(this.modelCls);

            session = SessionProxy.getSession(creds, event.region);
            action = event.action;
        } catch(err) {
            LOGGER.error('Invalid request');
            throw new InternalFailure(`${err} (${err.name})`);
        }

        return [session, request, action, event.callbackContext || new Map<string, any>()];
    }

    // @ts-ignore
    public async testEntrypoint (
        eventData: Object | Map<string, any>, context: any
    ): Promise<ProgressEvent>;
    @boundMethod
    @ensureSerialize()
    public async testEntrypoint(
        eventData: Map<string, any>, context: any
    ): Promise<ProgressEvent> {
        let msg = 'Uninitialized';
        let progress: ProgressEvent;
        try {
            const [ session, request, action, callbackContext ] = this.parseTestRequest(eventData);
            progress = await this.invokeHandler(session, request, action, callbackContext);
        } catch(err) {
            if (err instanceof BaseHandlerException) {
                LOGGER.error('Handler error')
                progress = err.toProgressEvent();
            } else {
                LOGGER.error('Exception caught');
                msg = err.message || msg;
                progress = ProgressEvent.failed(HandlerErrorCode.InternalFailure, msg);
            }
        }
        return Promise.resolve(progress);
    }

    private static parseRequest = (
        eventData: Map<string, any>
    ): [
        [Optional<SessionProxy>, Optional<SessionProxy>, SessionProxy],
        Action,
        Map<string, any>,
        HandlerRequest,
    ] => {
        let callerSession: Optional<SessionProxy>;
        let platformSession: Optional<SessionProxy>;
        let providerSession: SessionProxy;
        let action: Action;
        let callbackContext: Map<string, any>;
        let event: HandlerRequest;
        try {
            event = HandlerRequest.deserialize(eventData);
            if (!event.awsAccountId) {
                throw new Error('Event data is missing required property "awsAccountId".')
            }
            const platformCredentials = event.requestData.platformCredentials;
            platformSession = SessionProxy.getSession(platformCredentials);
            callerSession = SessionProxy.getSession(event.requestData.callerCredentials);
            providerSession = SessionProxy.getSession(event.requestData.providerCredentials);
            // Credentials are used when rescheduling, so can't zero them out (for now).
            if (!platformSession || !platformCredentials || Object.keys(platformCredentials).length === 0) {
                throw new Error('No platform credentials');
            }
            action = event.action;
            callbackContext = event.requestContext?.callbackContext || new Map<string, any>();
        } catch(err) {
            LOGGER.error('Invalid request');
            throw new InvalidRequest(`${err} (${err.name})`);
        }
        return [
            [callerSession, platformSession, providerSession],
            action,
            callbackContext,
            event,
        ]
    }

    private castResourceRequest = (
        request: HandlerRequest
    ): BaseResourceHandlerRequest<T> => {
        try {
            const unmodeled: UnmodeledRequest = UnmodeledRequest.fromUnmodeled({
                clientRequestToken: request.bearerToken,
                desiredResourceState: request.requestData.resourceProperties,
                previousResourceState: request.requestData.previousResourceProperties,
                logicalResourceIdentifier: request.requestData.logicalResourceId,
            });
            return unmodeled.toModeled<T>(this.modelCls);
        } catch(err) {
            LOGGER.error('Invalid request');
            throw new InvalidRequest(`${err} (${err.name})`);
        }
    }

    // @ts-ignore
    public async entrypoint (
        eventData: Object | Map<string, any>, context: LambdaContext
    ): Promise<CfnResponse<BaseResource>>;
    @boundMethod
    @ensureSerialize(true)
    public async entrypoint (
        eventData: Map<string, any>, context: LambdaContext
    ): Promise<ProgressEvent> {

        let isLogSetup: boolean = false;
        let progress: ProgressEvent;

        const printOrLog = (message: string): void => {
            if (isLogSetup) {
                LOGGER.error(message);
            } else {
                console.log(message);
                console.trace();
            }
        }

        try {
            const [sessions, action, callback, event] = BaseResource.parseRequest(eventData);
            const [callerSession, platformSession, providerSession] = sessions;
            isLogSetup = await ProviderLogHandler.setup(event, providerSession);

            const request = this.castResourceRequest(event);

            const metrics = new MetricsPublisherProxy(event.awsAccountId, event.resourceType);
            metrics.addMetricsPublisher(platformSession);
            metrics.addMetricsPublisher(providerSession);
            // Acknowledge the task for first time invocation.
            if (!event.requestContext || Object.keys(event.requestContext).length === 0) {
                await reportProgress({
                    session: platformSession,
                    bearerToken: event.bearerToken,
                    errorCode: null,
                    operationStatus: OperationStatus.InProgress,
                    currentOperationStatus: OperationStatus.Pending,
                    resourceModel: null,
                    message: '',
                });
            } else {
                // If this invocation was triggered by a 're-invoke' CloudWatch Event,
                // clean it up.
                await cleanupCloudwatchEvents(
                    platformSession,
                    event.requestContext.cloudWatchEventsRuleName || '',
                    event.requestContext.cloudWatchEventsTargetId || '',
                );
            }
            let invoke: boolean = true;
            while (invoke) {
                const startTime = new Date(Date.now());
                await metrics.publishInvocationMetric(startTime, action);
                let error: Error;
                try {
                    progress = await this.invokeHandler(
                        callerSession, request, action, callback
                    );
                } catch(err) {
                    error = err;
                }
                const endTime = new Date(Date.now());
                const milliseconds: number = endTime.getTime() - startTime.getTime();
                await metrics.publishDurationMetric(endTime, action, milliseconds);
                if (error) {
                    await metrics.publishExceptionMetric(new Date(Date.now()), action, error);
                    throw error;
                }
                if (progress.callbackContext) {
                    const callback = progress.callbackContext;
                    if (!event.requestContext) {
                        event.requestContext = {} as RequestContext<Map<string, any>>;
                    }
                    event.requestContext.callbackContext = callback;
                }
                if (MUTATING_ACTIONS.includes(event.action)) {
                    await reportProgress({
                        session: platformSession,
                        bearerToken: event.bearerToken,
                        errorCode: progress.errorCode,
                        operationStatus: progress.status,
                        currentOperationStatus: OperationStatus.InProgress,
                        resourceModel: progress.resourceModel,
                        message: progress.message,
                    });
                }
                invoke = await BaseResource.scheduleReinvocation(
                    event, progress, context, platformSession
                );
            }
        } catch(err) {
            if (err instanceof BaseHandlerException) {
                printOrLog('Handler error');
                progress = err.toProgressEvent();
            } else {
                printOrLog('Exception caught');
                progress = ProgressEvent.failed(HandlerErrorCode.InternalFailure, err.message);
            }
        }
        if (isLogSetup) {
            const providerLogHandler = ProviderLogHandler.getInstance();
            await providerLogHandler.processLogs();
        }
        return progress;
    }
}
