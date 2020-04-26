import { ConfigurationOptions } from 'aws-sdk/lib/config';
import { CredentialsOptions } from 'aws-sdk/lib/credentials';
import * as Aws from 'aws-sdk/clients/all';
import { NextToken } from 'aws-sdk/clients/cloudformation';
import { allArgsConstructor, builder, IBuilder } from 'tombok';

import {
    BaseResourceHandlerRequest,
    BaseResourceModel,
    HandlerErrorCode,
    OperationStatus,
} from './interface';

type ClientMap = typeof Aws;
type Client = InstanceType<ClientMap[keyof ClientMap]>;

export class SessionProxy {
    constructor(private options: ConfigurationOptions) {}

    public client(name: keyof ClientMap, options?: ConfigurationOptions): Client {
        const clients: { [K in keyof ClientMap]: ClientMap[K] } = Aws;
        const service: Client = new clients[name]({
            ...this.options,
            ...options,
        });
        return service;
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

@allArgsConstructor
@builder
export class ProgressEvent<
    R extends BaseResourceModel = BaseResourceModel,
    T = Map<string, any>
> {
    /**
     * The status indicates whether the handler has reached a terminal state or is
     * still computing and requires more time to complete
     */
    public status: OperationStatus;

    /**
     * If OperationStatus is FAILED or IN_PROGRESS, an error code should be provided
     */
    public errorCode?: HandlerErrorCode;

    /**
     * The handler can (and should) specify a contextual information message which
     * can be shown to callers to indicate the nature of a progress transition or
     * callback delay; for example a message indicating "propagating to edge"
     */
    public message = '';

    /**
     * The callback context is an arbitrary datum which the handler can return in an
     * IN_PROGRESS event to allow the passing through of additional state or
     * metadata between subsequent retries; for example to pass through a Resource
     * identifier which can be used to continue polling for stabilization
     */
    public callbackContext?: T;

    /**
     * A callback will be scheduled with an initial delay of no less than the number
     * of seconds specified in the progress event.
     */
    public callbackDelaySeconds = 0;

    /**
     * The output resource instance populated by a READ for synchronous results and
     * by CREATE/UPDATE/DELETE for final response validation/confirmation
     */
    public resourceModel?: R;

    /**
     * The output resource instances populated by a LIST for synchronous results
     */
    public resourceModels?: Array<R>;

    /**
     * The token used to request additional pages of resources for a LIST operation
     */
    public nextToken?: NextToken;

    // TODO: remove workaround when decorator mutation implemented: https://github.com/microsoft/TypeScript/issues/4881
    constructor(...args: any[]) {}
    public static builder(template?: Partial<ProgressEvent>): IBuilder<ProgressEvent> {
        return null;
    }

    public serialize(toTesponse = false, bearerToken?: string): Map<string, any> {
        // To match Java serialization, which drops 'null' values, and the
        // contract tests currently expect this also.
        const json: Map<string, any> = new Map<string, any>(Object.entries(this)); //JSON.parse(JSON.stringify(this)));
        json.forEach((value: any, key: string) => {
            if (value == null) {
                json.delete(key);
            }
        });
        // Mutate to what's expected in the response.
        if (toTesponse) {
            json.set('bearerToken', bearerToken);
            json.set('operationStatus', json.get('status'));
            json.delete('status');
            if (this.resourceModel) {
                json.set('resourceModel', this.resourceModel.toObject());
            }
            if (this.resourceModels) {
                const models = this.resourceModels.map((resource: R) =>
                    resource.toObject()
                );
                json.set('resourceModels', models);
            }
            json.delete('callbackDelaySeconds');
            if (json.has('callbackContext')) {
                json.delete('callbackContext');
            }
            if (this.errorCode) {
                json.set('errorCode', this.errorCode);
            }
        }
        return json;
    }

    /**
     * Convenience method for constructing FAILED response
     */
    public static failed(errorCode: HandlerErrorCode, message: string): ProgressEvent {
        const event = ProgressEvent.builder()
            .status(OperationStatus.Failed)
            .errorCode(errorCode)
            .message(message)
            .build();
        return event;
    }

    /**
     * Convenience method for constructing IN_PROGRESS response
     */
    public static progress(model?: any, ctx?: any): ProgressEvent {
        const progress = ProgressEvent.builder().status(OperationStatus.InProgress);
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
    public static success(model?: any, ctx?: any): ProgressEvent {
        const event = ProgressEvent.progress(model, ctx);
        event.status = OperationStatus.Success;
        return event;
    }

    public toObject(): any {
        // @ts-ignore
        const obj = Object.fromEntries(this.serialize().entries());
        return obj;
    }
}

/**
 * This interface describes the request object for the provisioning request
 * passed to the implementor. It is transformed from an instance of
 * HandlerRequest by the LambdaWrapper to only items of concern
 *
 * @param <T> Type of resource model being provisioned
 */
@allArgsConstructor
@builder
export class ResourceHandlerRequest<
    T extends BaseResourceModel
> extends BaseResourceHandlerRequest<T> {
    public clientRequestToken: string;
    public desiredResourceState: T;
    public previousResourceState: T;
    public desiredResourceTags: Map<string, string>;
    public systemTags: Map<string, string>;
    public awsAccountId: string;
    public awsPartition: string;
    public logicalResourceIdentifier: string;
    public nextToken: string;
    public region: string;

    constructor(...args: any[]) {
        super();
    }
    public static builder(): any {
        return null;
    }
}
