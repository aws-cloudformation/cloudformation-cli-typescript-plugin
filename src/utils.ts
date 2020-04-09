import {
    LogGroupName,
    LogicalResourceId,
    NextToken,
} from 'aws-sdk/clients/cloudformation';
import { allArgsConstructor } from 'tombok';
import {
    Action,
    BaseResourceHandlerRequest,
    BaseResourceModel,
    Credentials,
    RequestContext,
} from './interface';


export type Constructor<T = {}> = new (...args: any[]) => T;

/**
 * Convert minutes to a valid scheduling expression to be used in the AWS Events
 * 
 * @param {number} minutes Minutes to be converted
 */
export function minToCron(minutes: number): string {
    const date = new Date(Date.now());
    // add another minute, as per java implementation
    date.setMinutes(date.getMinutes() + minutes + 1);
    return `cron(${date.getMinutes()} ${date.getHours()} ${date.getDate()} ${date.getMonth()} ? ${date.getFullYear()})`;
}

@allArgsConstructor
export class TestEvent {
    credentials: Credentials;
    action: Action;
    request: Map<string, any>;
    callbackContext: Map<string, any>;
    region?: string;

    constructor(...args: any[]) {}
}

@allArgsConstructor
export class RequestData<T = Map<string, any>> {
    callerCredentials?: Credentials;
    platformCredentials?: Credentials;
    providerCredentials?: Credentials;
    providerLogGroupName: LogGroupName;
    logicalResourceId: LogicalResourceId;
    resourceProperties: T;
    previousResourceProperties?: T;
    systemTags: { [index: string]: string };
    stackTags?: { [index: string]: string };
    previousStackTags?: { [index: string]: string };

    constructor(...args: any[]) {}

    public static deserialize(jsonData: Map<string, any>): RequestData {
        if (!jsonData) {
            jsonData = new Map<string, any>();
        }
        const reqData: RequestData = new RequestData(jsonData);
        jsonData.forEach((value: any, key: string) => {
            if (key.endsWith('Credentials')) {
                type credentialsType = 'callerCredentials' | 'platformCredentials' | 'providerCredentials';
                const prop: credentialsType = key as credentialsType;
                const creds = value;
                if (creds) {
                    reqData[prop] = creds as Credentials;
                }
            }
        });
        return reqData;
    }

    serialize(): Map<string, any> {
        return null;
    }
}

@allArgsConstructor
export class HandlerRequest<ResourceT = Map<string, any>, CallbackT = Map<string, any>> {
    action: Action;
    awsAccountId: string;
    bearerToken: string;
    nextToken?: NextToken;
    region: string;
    responseEndpoint: string;
    resourceType: string;
    resourceTypeVersion: string;
    requestData: RequestData<ResourceT>;
    stackId: string;
    requestContext: RequestContext<CallbackT>;

    constructor(...args: any[]) {}

    public static deserialize(jsonData: Map<string, any>): HandlerRequest {
        if (!jsonData) {
            jsonData = new Map<string, any>();
        }
        const event: HandlerRequest = new HandlerRequest(jsonData);
        const requestData = new Map<string, any>(Object.entries(jsonData.get('requestData') || {}));
        event.requestData = RequestData.deserialize(requestData);
        return event;
    };

    public fromJSON(jsonData: Map<string, any>): HandlerRequest {
        return null;
    };

    public toJSON(): any {
        return null;
    };
}

@allArgsConstructor
export class UnmodeledRequest extends BaseResourceHandlerRequest<BaseResourceModel> {

    constructor(...args: any[]) {super()}

    public static fromUnmodeled(obj: Object): UnmodeledRequest {
        const mapped = new Map(Object.entries(obj));
        const request: UnmodeledRequest = new UnmodeledRequest(mapped);
        return request;
    }

    public toModeled<T extends BaseResourceModel = BaseResourceModel>(modelCls: Constructor<T> & { deserialize?: Function }): BaseResourceHandlerRequest<T> {
        return new BaseResourceHandlerRequest<T>(new Map(Object.entries({
            clientRequestToken: this.clientRequestToken,
            desiredResourceState: modelCls.deserialize(this.desiredResourceState || {}),
            previousResourceState: modelCls.deserialize(this.previousResourceState || {}),
            logicalResourceIdentifier: this.logicalResourceIdentifier,
            nextToken: this.nextToken,
        })));
    }
}

export interface LambdaContext {
    invokedFunctionArn: string;
    getRemainingTimeInMillis(): number;
}
