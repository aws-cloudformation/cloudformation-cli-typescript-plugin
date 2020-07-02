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
    Credentials,
    HandlerErrorCode,
    OperationStatus,
    Optional,
    RequestContext,
} from './interface';
import { ProviderLogHandler } from './log-delivery';
import { MetricsPublisherProxy } from './metrics';
import {
    Constructor,
    HandlerRequest,
    LambdaContext,
    TestEvent,
    UnmodeledRequest,
} from './utils';

const LOGGER = console;
const MUTATING_ACTIONS: [Action, Action, Action] = [
    Action.Create,
    Action.Update,
    Action.Delete,
];

export type HandlerSignature = Callable<
    [Optional<SessionProxy>, any, Map<string, any>],
    Promise<ProgressEvent>
>;
export class HandlerSignatures extends Map<Action, HandlerSignature> {}
class HandlerEvents extends Map<Action, string | symbol> {}

/**
 * Decorates a method to ensure that the JSON input and output are serialized properly.
 *
 * @returns {MethodDecorator}
 */
function ensureSerialize(toResponse = false): MethodDecorator {
    return function (
        target: any,
        propertyKey: string,
        descriptor: PropertyDescriptor
    ): PropertyDescriptor {
        type Resource = typeof target;
        // Save a reference to the original method this way we keep the values currently in the
        // descriptor and don't overwrite what another decorator might have done to the descriptor.
        if (descriptor === undefined) {
            descriptor = Object.getOwnPropertyDescriptor(target, propertyKey);
        }
        const originalMethod = descriptor.value;
        // Wrapping the original method with new signature.
        descriptor.value = async function (
            event: any | Map<string, any>,
            context: any
        ): Promise<ProgressEvent | CfnResponse<Resource>> {
            let mappedEvent: Map<string, any>;
            if (event instanceof Map) {
                mappedEvent = new Map<string, any>(event);
            } else {
                mappedEvent = new Map<string, any>(Object.entries(event));
            }
            const progress: ProgressEvent = await originalMethod.apply(this, [
                mappedEvent,
                context,
            ]);
            if (toResponse) {
                // Use the raw event data as a last-ditch attempt to call back if the
                // request is invalid.
                const serialized = progress.serialize();
                return Promise.resolve(serialized.toObject() as CfnResponse<Resource>);
            }
            return Promise.resolve(progress);
        };
        return descriptor;
    };
}

export abstract class BaseResource<T extends BaseModel = BaseModel> {
    constructor(
        public typeName: string,
        private modelCls: Constructor<T>,
        private handlers?: HandlerSignatures
    ) {
        this.typeName = typeName || '';
        this.handlers = handlers || new HandlerSignatures();
        const actions: HandlerEvents =
            Reflect.getMetadata('handlerEvents', this) || new HandlerEvents();
        actions.forEach((value: string | symbol, key: Action) => {
            this.addHandler(key, (this as any)[value]);
        });
    }

    public addHandler = (action: Action, f: HandlerSignature): HandlerSignature => {
        this.handlers.set(action, f);
        return f;
    };

    private invokeHandler = async (
        session: Optional<SessionProxy>,
        request: BaseResourceHandlerRequest<T>,
        action: Action,
        callbackContext: Map<string, any>
    ): Promise<ProgressEvent> => {
        const handle: HandlerSignature = this.handlers.get(action);
        if (!handle) {
            return ProgressEvent.failed(
                HandlerErrorCode.InternalFailure,
                `No handler for ${action}`
            );
        }
        const progress = await handle(session, request, callbackContext);
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
        eventData: Map<string, any>
    ): [
        Optional<SessionProxy>,
        BaseResourceHandlerRequest<T>,
        Action,
        Map<string, any>
    ] => {
        let session: SessionProxy;
        let request: BaseResourceHandlerRequest<T>;
        let action: Action;
        let event: TestEvent;
        try {
            event = new TestEvent(eventData);
            const creds = event.credentials as Credentials;
            if (!creds) {
                throw new Error(
                    'Event data is missing required property "credentials".'
                );
            }
            if (!this.modelCls) {
                throw new Error(
                    'Missing Model class to be used to deserialize JSON data.'
                );
            }
            if (event.request instanceof Map) {
                event.request = new Map<string, any>(event.request);
            } else {
                event.request = new Map<string, any>(Object.entries(event.request));
            }
            request = new UnmodeledRequest(event.request).toModeled<T>(this.modelCls);

            session = SessionProxy.getSession(creds, event.region);
            action = event.action;
        } catch (err) {
            LOGGER.error('Invalid request');
            throw new InternalFailure(`${err} (${err.name})`);
        }

        return [
            session,
            request,
            action,
            event.callbackContext || new Map<string, any>(),
        ];
    };

    // @ts-ignore
    public async testEntrypoint(
        eventData: any | Map<string, any>,
        context: any
    ): Promise<ProgressEvent>;
    @boundMethod
    @ensureSerialize()
    public async testEntrypoint(
        eventData: Map<string, any>,
        context: any
    ): Promise<ProgressEvent> {
        let msg = 'Uninitialized';
        let progress: ProgressEvent;
        try {
            const [session, request, action, callbackContext] = this.parseTestRequest(
                eventData
            );
            progress = await this.invokeHandler(
                session,
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
                LOGGER.error(`Handler error: ${err.message}`, err);
                progress = err.toProgressEvent();
            } else {
                LOGGER.error(`Exception caught: ${err.message}`, err);
                msg = err.message || msg;
                progress = ProgressEvent.failed(HandlerErrorCode.InternalFailure, msg);
            }
        }
        return Promise.resolve(progress);
    }

    private static parseRequest = (
        eventData: Map<string, any>
    ): [
        [Optional<SessionProxy>, SessionProxy],
        Action,
        Map<string, any>,
        HandlerRequest
    ] => {
        let callerSession: Optional<SessionProxy>;
        let providerSession: SessionProxy;
        let action: Action;
        let callbackContext: Map<string, any>;
        let event: HandlerRequest;
        try {
            event = HandlerRequest.deserialize(eventData);
            if (!event.awsAccountId) {
                throw new Error(
                    'Event data is missing required property "awsAccountId".'
                );
            }
            callerSession = SessionProxy.getSession(
                event.requestData.callerCredentials
            );
            providerSession = SessionProxy.getSession(
                event.requestData.providerCredentials
            );
            action = event.action;
            callbackContext = event.callbackContext || new Map<string, any>();
        } catch (err) {
            LOGGER.error('Invalid request');
            throw new InvalidRequest(`${err} (${err.name})`);
        }
        return [[callerSession, providerSession], action, callbackContext, event];
    };

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
        } catch (err) {
            LOGGER.error('Invalid request');
            throw new InvalidRequest(`${err} (${err.name})`);
        }
    };

    // @ts-ignore
    public async entrypoint(
        eventData: any | Map<string, any>,
        context: LambdaContext
    ): Promise<CfnResponse<BaseResource>>;
    @boundMethod
    @ensureSerialize(true)
    public async entrypoint(
        eventData: Map<string, any>,
        context: LambdaContext
    ): Promise<ProgressEvent> {
        let isLogSetup = false;
        let progress: ProgressEvent;

        const printOrLog = (...args: any[]): void => {
            if (isLogSetup) {
                LOGGER.error(...args);
            } else {
                console.log(...args);
            }
        };

        try {
            const [sessions, action, callback, event] = BaseResource.parseRequest(
                eventData
            );
            const [callerSession, providerSession] = sessions;
            isLogSetup = await ProviderLogHandler.setup(event, providerSession);
            // LOGGER.debug('entrypoint eventData', eventData.toObject());
            const request = this.castResourceRequest(event);

            const metrics = new MetricsPublisherProxy(
                event.awsAccountId,
                event.resourceType
            );
            metrics.addMetricsPublisher(providerSession);

            const startTime = new Date(Date.now());
            await metrics.publishInvocationMetric(startTime, action);
            let error: Error;
            try {
                progress = await this.invokeHandler(
                    callerSession,
                    request,
                    action,
                    callback
                );
            } catch (err) {
                error = err;
            }
            const endTime = new Date(Date.now());
            const milliseconds: number = endTime.getTime() - startTime.getTime();
            await metrics.publishDurationMetric(endTime, action, milliseconds);
            if (error) {
                await metrics.publishExceptionMetric(
                    new Date(Date.now()),
                    action,
                    error
                );
                throw error;
            }
        } catch (err) {
            if (!err.stack) {
                Error.captureStackTrace(err);
            }
            err.stack = `${new Error().stack}\n${err.stack}`;
            if (err instanceof BaseHandlerException) {
                printOrLog(`Handler error: ${err.message}`, err);
                progress = err.toProgressEvent();
            } else {
                printOrLog(`Exception caught: ${err.message}`, err);
                progress = ProgressEvent.failed(
                    HandlerErrorCode.InternalFailure,
                    err.message
                );
            }
        }
        if (isLogSetup) {
            const providerLogHandler = ProviderLogHandler.getInstance();
            await providerLogHandler.processLogs();
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
