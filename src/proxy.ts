import { AWSError } from 'aws-sdk';
import Aws from 'aws-sdk/clients/all';
import { NextToken } from 'aws-sdk/clients/cloudformation';
import { CredentialsOptions } from 'aws-sdk/lib/credentials';
import { PromiseResult } from 'aws-sdk/lib/request';
import { Service, ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import { EventEmitter } from 'events';
import { builder, IBuilder } from '@org-formation/tombok';
import { Exclude, Expose, Type } from 'class-transformer';

import {
    BaseDto,
    BaseResourceHandlerRequest,
    BaseModel,
    Constructor,
    Dict,
    HandlerErrorCode,
    OperationStatus,
    OverloadedArguments,
    ServiceProperties,
} from './interface';

type ClientMap = typeof Aws;
export type ClientName = keyof ClientMap;
export type Client = InstanceType<ClientMap[ClientName]>;

export type Result<T> = T extends (...args: any) => infer R ? R : any;
export type Input<T> = T extends (...args: infer P) => any ? P : never;
export type ServiceOptions<S extends Service = Service> = ConstructorParameters<
    Constructor<S>
>[0];
export type ServiceOperation<
    S extends Service = Service,
    C extends Constructor<S> = Constructor<S>,
    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
    E extends Error = AWSError
> = InstanceType<C>[O] & {
    promise(): Promise<PromiseResult<any, E>>;
};
export type InferredResult<
    S extends Service = Service,
    C extends Constructor<S> = Constructor<S>,
    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
    E extends Error = AWSError,
    N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
> = Input<Input<Result<Result<N>['promise']>['then']>[0]>[0];

type AwsTaskSignature = <
    S extends Service = Service,
    C extends Constructor<S> = Constructor<S>,
    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
    E extends Error = AWSError,
    N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
>(
    params: any
) => Promise<InferredResult<S, C, O, E, N>>;

/**
 * Promise final result Type from a AWS Service Function
 *
 * @param S Type of the AWS Service
 * @param C Type of the constructor function of the AWS Service
 * @param O Names of the operations (method) within the service
 * @param E Type of the error thrown by the service function
 * @param N Type of the service function inferred by the given operation name
 */
export type ExtendedClient<S extends Service = Service> = S & {
    serviceIdentifier?: string;
    makeRequestPromise?: <
        C extends Constructor<S> = Constructor<S>,
        O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
        E extends Error = AWSError,
        N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
    >(
        operation: O,
        input?: OverloadedArguments<N>,
        headers?: Record<string, string>
    ) => Promise<InferredResult<S, C, O, E, N>>;
};
export interface AwsTaskWorkerPool extends EventEmitter {
    runAwsTask: AwsTaskSignature;
    shutdown: (doDestroy?: boolean) => Promise<boolean>;
    completed?: number;
    duration?: number;
}
export interface Session {
    client: <S extends Service>(
        service: ClientName | S | Constructor<S>,
        options?: ServiceConfigurationOptions
    ) => ExtendedClient<S>;
}

export class SessionProxy implements Session {
    constructor(private options: ServiceConfigurationOptions) {}

    private extendAwsClient<
        S extends Service = Service,
        C extends Constructor<S> = Constructor<S>,
        O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
        E extends Error = AWSError,
        N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
    >(
        service: S,
        options?: ServiceConfigurationOptions,
        workerPool?: AwsTaskWorkerPool
    ): ExtendedClient<S> {
        const client: ExtendedClient<S> = new Proxy(service, {
            get(obj: ExtendedClient<S>, prop: string) {
                if ('makeRequestPromise' === prop) {
                    // Extend AWS client with promisified make request method
                    // that can be used with worker pool
                    return async (
                        operation: O,
                        input?: OverloadedArguments<N>,
                        headers?: Record<string, string>
                    ): Promise<InferredResult<S, C, O, E, N>> => {
                        if (workerPool && workerPool.runAwsTask) {
                            try {
                                const result = await workerPool.runAwsTask<
                                    S,
                                    C,
                                    O,
                                    E,
                                    N
                                >({
                                    name: obj.serviceIdentifier,
                                    options,
                                    operation,
                                    input,
                                    headers,
                                });
                                return result;
                            } catch (err) {
                                console.log(err);
                            }
                        }
                        const request = obj.makeRequest(operation as string, input);
                        const headerEntries = Object.entries(headers || {});
                        if (headerEntries.length) {
                            request.on('build', () => {
                                for (const [key, value] of headerEntries) {
                                    request.httpRequest.headers[key] = value;
                                }
                            });
                        }
                        return await request.promise();
                    };
                }
                return obj[prop];
            },
        });
        if (client.config && client.config.update) {
            client.config.update(options);
        }
        return client;
    }

    public client<S extends Service = Service>(
        service: ClientName | S | Constructor<S>,
        options?: ServiceConfigurationOptions,
        workerPool?: AwsTaskWorkerPool
    ): ExtendedClient<S> {
        const updatedConfig = { ...this.options, ...options };
        let ctor: Constructor<S>;
        let client: ExtendedClient<S>;
        if (typeof service === 'string') {
            // Kept for backward compatibility
            const clients: { [K in ClientName]: ClientMap[K] } = Aws;
            ctor = (clients[service] as unknown) as Constructor<S>;
        } else if (typeof service === 'function') {
            ctor = service as Constructor<S>;
        } else {
            client = this.extendAwsClient(service, updatedConfig, workerPool);
        }
        if (!client) {
            client = this.extendAwsClient(
                new ctor(updatedConfig),
                updatedConfig,
                workerPool
            );
        }
        return client;
    }

    get configuration(): ServiceConfigurationOptions {
        return this.options;
    }

    public static getSession(
        credentials?: CredentialsOptions,
        region?: string
    ): SessionProxy | null {
        if (!credentials) {
            return null;
        }
        return new SessionProxy({
            credentials,
            region,
        });
    }
}

@builder
export class ProgressEvent<
    ResourceT extends BaseModel = BaseModel,
    CallbackT = Dict
> extends BaseDto {
    /**
     * The status indicates whether the handler has reached a terminal state or is
     * still computing and requires more time to complete
     */
    @Expose() status: OperationStatus;

    /**
     * If OperationStatus is FAILED or IN_PROGRESS, an error code should be provided
     */
    @Expose() errorCode?: HandlerErrorCode;

    /**
     * The handler can (and should) specify a contextual information message which
     * can be shown to callers to indicate the nature of a progress transition or
     * callback delay; for example a message indicating "propagating to edge"
     */
    @Expose() message = '';

    /**
     * The callback context is an arbitrary datum which the handler can return in an
     * IN_PROGRESS event to allow the passing through of additional state or
     * metadata between subsequent retries; for example to pass through a Resource
     * identifier which can be used to continue polling for stabilization
     */
    @Expose() callbackContext?: CallbackT;

    /**
     * A callback will be scheduled with an initial delay of no less than the number
     * of seconds specified in the progress event.
     */
    @Expose() callbackDelaySeconds = 0;

    /**
     * The output resource instance populated by a READ for synchronous results and
     * by CREATE/UPDATE/DELETE for final response validation/confirmation
     */
    @Expose() resourceModel?: ResourceT;

    /**
     * The output resource instances populated by a LIST for synchronous results
     */
    @Expose() resourceModels?: Array<ResourceT>;

    /**
     * The token used to request additional pages of resources for a LIST operation
     */
    @Expose() nextToken?: NextToken;

    constructor(partial?: Partial<ProgressEvent>) {
        super();
        if (partial) {
            Object.assign(this, partial);
        }
    }

    // TODO: remove workaround when decorator mutation implemented: https://github.com/microsoft/TypeScript/issues/4881
    @Exclude()
    public static builder<T extends ProgressEvent>(template?: Partial<T>): IBuilder<T> {
        /* istanbul ignore next */
        return null;
    }

    /**
     * Convenience method for constructing FAILED response
     */
    @Exclude()
    public static failed<T extends ProgressEvent>(
        errorCode: HandlerErrorCode,
        message: string
    ): T {
        const event = ProgressEvent.builder<T>()
            .status(OperationStatus.Failed)
            .errorCode(errorCode)
            .message(message)
            .build();
        return event;
    }

    /**
     * Convenience method for constructing IN_PROGRESS response
     */
    @Exclude()
    public static progress<T extends ProgressEvent>(model?: any, ctx?: any): T {
        const progress = ProgressEvent.builder<T>().status(OperationStatus.InProgress);
        if (ctx) {
            progress.callbackContext(ctx);
        }
        if (model) {
            progress.resourceModel(model);
        }
        const event = progress.build();
        return event;
    }

    /**
     * Convenience method for constructing a SUCCESS response
     */
    @Exclude()
    public static success<T extends ProgressEvent>(model?: any, ctx?: any): T {
        const event = ProgressEvent.progress<T>(model, ctx);
        event.status = OperationStatus.Success;
        return event;
    }
}

/**
 * This interface describes the request object for the provisioning request
 * passed to the implementor. It is transformed from an instance of
 * HandlerRequest by the LambdaWrapper to only items of concern
 *
 * @param <T> Type of resource model being provisioned
 */
export class ResourceHandlerRequest<
    T extends BaseModel
> extends BaseResourceHandlerRequest<T> {}
