import { AWSError, Request } from 'aws-sdk';
import { ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import { serializeError } from 'serialize-error';

import { ClientName, SessionProxy } from '../proxy';

// Error.stackTraceLimit = Infinity;

export interface ClientApiOptions {
    name: ClientName;
    options: ServiceConfigurationOptions;
    operation: string;
    input: any;
    headers?: { [key: string]: string };
}

export default async function clientApi(params: ClientApiOptions): Promise<any> {
    console.debug(params);
    const { name, options, operation, input, headers } = params;
    const session = new SessionProxy({});
    const client = session.client(name, options);
    // console.debug(client, { showHidden: false, depth: 10 });
    try {
        const request = client.makeRequest(operation, input);
        if (headers?.length) {
            request.on('build', (req: Request<any, AWSError>) => {
                for (const [key, value] of Object.entries(headers)) {
                    req.httpRequest.headers[key] = value;
                }
            });
        }
        return await request.promise();
    } catch (err) {
        console.debug(err);
        throw serializeError(err);
    }
}
