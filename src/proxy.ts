import type {
    AwsCredentialIdentity,
    MemoizedProvider,
    EndpointV2,
} from '@smithy/types';
import { builder, IBuilder } from './builder';
import { Exclude, Expose } from 'class-transformer';

import {
    BaseDto,
    BaseResourceHandlerRequest,
    BaseModel,
    Dict,
    HandlerErrorCode,
    OperationStatus,
} from './interface';

type NextToken = string;

// Base Client Config properties that we reuse for easier client instantiation
interface BaseAwsClientConfig {
    credentials: MemoizedProvider<AwsCredentialIdentity>;
    endpoint?: EndpointV2;
    region: string;
}

type ConstructorReturnType<T> = T extends new (...args: any) => infer R ? R : never;

export interface Session {
    client: <ClientConstructor extends new (...args: any) => any>(
        _ClientConstructor: ClientConstructor,
        clientOptions?: ConstructorParameters<typeof _ClientConstructor>[0]
    ) => ConstructorReturnType<ClientConstructor>;
}

export class SessionProxy {
    constructor(private options: BaseAwsClientConfig) {}

    public client<ClientConstructor extends new (...args: any) => any>(
        _ClientConstructor: ClientConstructor,
        clientOptions?: ConstructorParameters<typeof _ClientConstructor>[0]
    ): ConstructorReturnType<ClientConstructor> {
        // There's too many dissociating types in the sdk, we will just cast
        return new _ClientConstructor({
            ...this.options,
            ...clientOptions,
        });
    }

    get configuration(): BaseAwsClientConfig {
        return this.options;
    }

    public static getSession(
        credentials?: AwsCredentialIdentity,
        region?: string,
        endpoint?: EndpointV2
    ): SessionProxy | null {
        if (!credentials) {
            return null;
        }
        return new SessionProxy({
            credentials: () => Promise.resolve(credentials),
            region,
            endpoint,
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
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
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
