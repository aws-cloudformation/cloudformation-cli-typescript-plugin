import { boundMethod } from 'autobind-decorator';
import { EventEmitter } from 'events';
import CloudWatchLogs, {
    InputLogEvent,
    PutLogEventsRequest,
    PutLogEventsResponse,
} from 'aws-sdk/clients/cloudwatchlogs';

import { SessionProxy } from './proxy';
import { HandlerRequest } from './utils';


type Console = globalThis.Console;

interface ILogOptions {
    groupName: string,
    stream: string,
    session: SessionProxy,
    logger?: Console,
}

class LogEmitter extends EventEmitter {}

export class ProviderLogHandler {
    private static instance: ProviderLogHandler;
    private emitter: LogEmitter;
    public client: CloudWatchLogs;
    public sequenceToken: string;
    public groupName: string;
    public stream: string;
    private logger: Console;

    /**
     * The ProviderLogHandler's constructor should always be private to prevent direct
     * construction calls with the `new` operator.
     */
    private constructor(options: ILogOptions) {
        this.groupName = options.groupName;
        this.stream = options.stream.replace(':', '__');
        this.client = options.session.client('CloudWatchLogs') as CloudWatchLogs;
        this.sequenceToken = '';
        this.logger = options.logger || global.console;
        // Attach the logger methods to localized event emitter.
        const emitter = new LogEmitter();
        this.emitter = emitter;
        this.emitter.on('log', this.logListener);
        // Create maps of each logger Function and then alias that.
        Object.entries(this.logger).forEach(([key, val]) => {
            if (typeof val === 'function') {
                if (['log', 'error', 'warn', 'info'].includes(key)) {
                    this.logger[key as 'log' | 'error' | 'warn' | 'info'] = function() {
                        // Calls the logger method.
                        val.apply(this, arguments);
                        // For adding other event watchers later.
                        emitter.emit('log', arguments);
                    };
                }
            }
        });
    }

    /**
     * The static method that controls the access to the singleton instance.
     *
     * This implementation let you subclass the ProviderLogHandler class while keeping
     * just one instance of each subclass around.
     */
    public static getInstance(): ProviderLogHandler {
        if (!ProviderLogHandler.instance) {
            return null;
        }
        return ProviderLogHandler.instance;
    }

    public static setup(
        request: HandlerRequest, providerSession?: SessionProxy
    ): void {
        const logGroup: string = request.requestData?.providerLogGroupName;
        let streamName: string = `${request.awsAccountId}-${request.region}`;
        if (request.stackId && request.requestData?.logicalResourceId) {
            streamName = `${request.stackId}/${request.requestData.logicalResourceId}`;
        }
        let logHandler = ProviderLogHandler.getInstance();
        if (providerSession && logGroup) {
            if (logHandler) {
                // This is a re-used lambda container, log handler is already setup, so
                // we just refresh the client with new creds.
                logHandler.client = providerSession.client('CloudWatchLogs') as CloudWatchLogs;
            } else {
                // Filter provider messages from platform.
                const provider: string = request.resourceType.replace('::', '_').toLowerCase();
                logHandler = ProviderLogHandler.instance = new ProviderLogHandler({
                    groupName: logGroup,
                    stream: streamName,
                    session: providerSession,
                });
            }
        }
    }

    private async createLogGroup(): Promise<void> {
        try {
            await this.client.createLogGroup({
                logGroupName: this.groupName,
            }).promise();
        } catch(err) {
            const errorCode = err.code || err.name;
            if (errorCode !== 'ResourceAlreadyExistsException') {
                throw err;
            }
        }
    }

    private async createLogStream(): Promise<void> {
        try {
            await this.client.createLogStream({
                logGroupName: this.groupName,
                logStreamName: this.stream,
            }).promise();
        } catch(err) {
            const errorCode = err.code || err.name;
            if (errorCode !== 'ResourceAlreadyExistsException') {
                throw err;
            }
        }
    }

    private async putLogEvents(record: InputLogEvent): Promise<void> {
        if (!record.timestamp) {
            const currentTime = new Date(Date.now());
            record.timestamp = Math.round(currentTime.getTime());
        }
        const logEventsParams: PutLogEventsRequest = {
            logGroupName: this.groupName,
            logStreamName: this.stream,
            logEvents: [ record ],
        };
        if (this.sequenceToken) {
            logEventsParams.sequenceToken = this.sequenceToken;
        }
        try {
            const response: PutLogEventsResponse = await this.client.putLogEvents(logEventsParams).promise();
            this.sequenceToken = response.nextSequenceToken;
        } catch(err) {
            const errorCode = err.code || err.name;
            if (errorCode === 'DataAlreadyAcceptedException' || errorCode === 'InvalidSequenceTokenException') {
                this.sequenceToken = (err.message || '').split(' ').pop();
                this.putLogEvents(record);
            } else {
                throw err;
            }
        }
    }

    @boundMethod
    async logListener(...args: any[]): Promise<void> {
        const currentTime = new Date(Date.now());
        const record: InputLogEvent = {
            message: JSON.stringify(args[0]),
            timestamp: Math.round(currentTime.getTime()),
        }
        try {
            await this.putLogEvents(record);
        } catch(err) {
            const errorCode = err.code || err.name;
            if (errorCode === 'ResourceNotFoundException') {
                if (err.message.includes('log group does not exist')) {
                    await this.createLogGroup();
                }
                await this.createLogStream();
                await this.putLogEvents(record);
            }
        }
    }
}
