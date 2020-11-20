import { AWSError } from 'aws-sdk';
import * as Aws from 'aws-sdk/clients/all';
import { PromiseResult } from 'aws-sdk/lib/request';
import { Service, ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import { serializeError } from 'serialize-error';

import { Constructor, OverloadedArguments, ServiceProperties } from '../interface';

type ClientMap = typeof Aws;
type ClientName = keyof ClientMap;
type ClientWithIdentifier<T extends ClientName> = ClientMap[T] & {
    serviceIdentifier?: string;
};

/**
 * Return Type of the AWS Service function
 *
 * @param T a function to infer return value from
 */
export type Result<T> = T extends (...args: any) => infer R ? R : any;

/**
 * Input Type of the AWs Service Function
 *
 * @param T a function to infer input args from
 */
export type Input<T> = T extends (...args: infer P) => any ? P : never;

/**
 * Type of options taken by the service constructor
 *
 * @param S Type of the AWS Service to mock
 */
export type ServiceOptions<S extends Service = Service> = ConstructorParameters<
    Constructor<S>
>[0];

/**
 * Describes a Service Operation in AWS SDK
 *
 * @param S Type of the AWS Service
 * @param C Type of the constructor function of the AWS Service
 * @param O Names of the operations (method) within the service
 * @param E Type of the error thrown by the service operation
 */
export type ServiceOperation<
    S extends Service = Service,
    C extends Constructor<S> = Constructor<S>,
    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
    E extends Error = AWSError
> = InstanceType<C>[O] & {
    promise(): Promise<PromiseResult<any, E>>;
};

/**
 * Inferred result Type from a AWS Service Function
 *
 * @param S Type of the AWS Service
 * @param C Type of the constructor function of the AWS Service
 * @param O Names of the operations (method) within the service
 * @param E Type of the error thrown by the service function
 * @param N Type of the service function inferred by the given operation name
 */
export type InferredResult<
    S extends Service = Service,
    C extends Constructor<S> = Constructor<S>,
    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
    E extends Error = AWSError,
    N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
> = Input<Input<Result<Result<N>['promise']>['then']>[0]>[0];

export interface ClientApiOptions<
    S extends Service = Service,
    C extends Constructor<S> = Constructor<S>,
    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
    E extends Error = AWSError,
    N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
> {
    name: string;
    options: ServiceOptions<S> | ServiceConfigurationOptions;
    operation: O | string;
    input: OverloadedArguments<N>;
    headers?: Record<string, string>;
}

function getClient<S extends Service = Service>(
    name: string,
    options: ServiceOptions<S> | ServiceConfigurationOptions
): S {
    const clients: { [K in ClientName]: ClientWithIdentifier<K> } = Aws;
    let clientName;
    try {
        clientName = Object.keys(Aws).find((service: string) => {
            return name === service || name === clients[service].serviceIdentifier;
        }) as ClientName;
        if (clientName) {
            const ClientConstructor = (clients[clientName] as unknown) as Constructor<
                S
            >;
            return new ClientConstructor(options);
        }
    } catch (err) {
        err.message = `Unable to find AWS service: ${name} or ${clientName}\n${err.message}`;
        throw Error(err);
    }
    throw Error(`Unable to find AWS service: ${name} or ${clientName}`);
}

export default async function clientApi<
    S extends Service = Service,
    C extends Constructor<S> = Constructor<S>,
    O extends ServiceProperties<S, C> = ServiceProperties<S, C>,
    E extends Error = AWSError,
    N extends ServiceOperation<S, C, O, E> = ServiceOperation<S, C, O, E>
>(params: ClientApiOptions<S, C, O, E, N>): Promise<InferredResult<S, C, O, E, N>> {
    try {
        // console.debug(params);
        const { name, options, operation, input, headers } = params;
        const client = getClient<S>(name, options);
        const request = client.makeRequest(operation as string, input);
        if (headers?.length) {
            request.on('build', () => {
                for (const [key, value] of Object.entries(headers)) {
                    request.httpRequest.headers[key] = value;
                }
            });
        }
        return await request.promise();
    } catch (err) {
        console.debug(err);
        throw serializeError(err);
    }
}
