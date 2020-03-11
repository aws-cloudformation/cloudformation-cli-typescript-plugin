import { ConfigurationOptions } from 'aws-sdk/lib/config';
import { CredentialsOptions } from 'aws-sdk/lib/credentials';
import * as Aws from 'aws-sdk/clients/all';
import { NextToken } from 'aws-sdk/clients/cloudformation';
import { allArgsConstructor, builder } from 'tombok';

import {
    BaseResourceModel,
    HandlerErrorCode,
    OperationStatus,
} from './interface';


type ClientMap = typeof Aws;
type Client = InstanceType<ClientMap[keyof ClientMap]>;

export class SessionProxy {

    constructor(private options: ConfigurationOptions) { }

    public resource(): void { }

    public client(name: keyof ClientMap, options?: ConfigurationOptions): Client {
        const clients: { [K in keyof ClientMap]: ClientMap[K] } = Aws;
        const service: Client = new clients[name]({
            ...this.options,
            ...options,
        });
        return service;
    }

    public static getSession(credentials?: CredentialsOptions, region?: string): SessionProxy | null {
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
export class ProgressEvent<R = BaseResourceModel, T = Map<string, any>> {
    /**
     * The status indicates whether the handler has reached a terminal state or is
     * still computing and requires more time to complete
     */
    private status: OperationStatus;

    /**
     * If OperationStatus is FAILED or IN_PROGRESS, an error code should be provided
     */
    private errorCode?: HandlerErrorCode;

    /**
     * The handler can (and should) specify a contextual information message which
     * can be shown to callers to indicate the nature of a progress transition or
     * callback delay; for example a message indicating "propagating to edge"
     */
    private message: string = '';

    /**
     * The callback context is an arbitrary datum which the handler can return in an
     * IN_PROGRESS event to allow the passing through of additional state or
     * metadata between subsequent retries; for example to pass through a Resource
     * identifier which can be used to continue polling for stabilization
     */
    private callbackContext?: T;

    /**
     * A callback will be scheduled with an initial delay of no less than the number
     * of seconds specified in the progress event.
     */
    private callbackDelaySeconds: number;

    /**
     * The output resource instance populated by a READ for synchronous results and
     * by CREATE/UPDATE/DELETE for final response validation/confirmation
     */
    private resourceModel?: R;

    /**
     * The output resource instances populated by a LIST for synchronous results
     */
    private resourceModels?: Array<R>;

    /**
     * The token used to request additional pages of resources for a LIST operation
     */
    private nextToken?: NextToken;

    public serialize(
        toTesponse: boolean = false, bearerToken?: string
    ): Map<string, any> {
        // to match Java serialization, which drops `null` values, and the
        // contract tests currently expect this also
        let ser: Map<string, any> = JSON.parse(JSON.stringify(this));

        return ser;
    }

    /**
     * Convenience method for constructing a FAILED response
     */
    public static failed(errorCode: HandlerErrorCode, message: string): ProgressEvent {
        // @ts-ignore
        const event = ProgressEvent.builder()
            .status(OperationStatus.Failed)
            .errorCode(errorCode)
            .message(message)
            .build();
        return event;
    }

    /**
     * Convenience method for constructing a IN_PROGRESS response
     */
    public static progress(model: any, cxt: any): ProgressEvent {
        // @ts-ignore
        const event = ProgressEvent.builder()
            .callbackContext(cxt)
            .resourceModel(model)
            .status(OperationStatus.InProgress)
            .build();
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
@allArgsConstructor
@builder
export class ResourceHandlerRequest<T> {
    private clientRequestToken: string;
    private desiredResourceState: T;
    private previousResourceState: T;
    private desiredResourceTags: Map<string, string>;
    private systemTags: Map<string, string>;
    private awsAccountId: string;
    private awsPartition: string;
    private logicalResourceIdentifier: string;
    private nextToken: string;
    private region: string;
}
