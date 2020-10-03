import { boundMethod } from 'autobind-decorator';
import { EventEmitter } from 'events';
import { format } from 'util';
import CloudWatchLogs, {
    DescribeLogStreamsResponse,
    LogStream,
    InputLogEvent,
    PutLogEventsRequest,
    PutLogEventsResponse,
} from 'aws-sdk/clients/cloudwatchlogs';
import { ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import S3, { PutObjectRequest, PutObjectOutput } from 'aws-sdk/clients/s3';
import promiseSequential from 'promise-sequential';
import { v4 as uuidv4 } from 'uuid';

import { SessionProxy } from './proxy';
import { HandlerRequest } from './interface';
import { MetricsPublisherProxy } from './metrics';
import { delay } from './utils';
import { exceptions } from '.';

type Console = globalThis.Console;
export type LambdaLogger = Partial<Console>;
type PromiseFunction = () => Promise<any>;

interface LogOptions {
    groupName: string;
    stream: string;
    session: SessionProxy;
    logger?: Console;
    accountId?: string;
}

class LogEmitter extends EventEmitter {}

export interface Logger {
    /**
     * Log a message to the default provider on this runtime.
     *
     * @param message The primary message.
     * @param optionalParams All additional used as substitution values.
     */
    log(message?: any, ...optionalParams: any[]): void;
}

interface LogFilter {
    applyFilter(rawInput: string): string;
}

export abstract class LogPublisher {
    private logFilterList: LogFilter[];

    constructor(...filters: readonly LogFilter[]) {
        this.logFilterList = Array.from(filters);
    }

    protected abstract publishMessage(message: string): Promise<void>;

    /**
     * Redact or scrub loggers in someway to help prevent leaking of certain
     * information.
     */
    private filterMessage(message: string): string {
        let toReturn: string = message;
        this.logFilterList.forEach((filter: LogFilter) => {
            toReturn = filter.applyFilter(toReturn);
        });
        return toReturn;
    }

    public async publishLogEvent(message: string): Promise<void> {
        await this.publishMessage(this.filterMessage(message));
    }
}

export class LambdaLogPublisher extends LogPublisher {
    constructor(
        private readonly logger: LambdaLogger,
        ...logFilters: readonly LogFilter[]
    ) {
        super(...logFilters);
    }

    protected publishMessage(message: string): Promise<void> {
        return Promise.resolve(this.logger.log(message));
    }
}

export class CloudWatchLogPublisher extends LogPublisher {
    private client: CloudWatchLogs;

    // Note: PutLogEvents returns a result that includes a sequence number.
    // That same sequence number must be used in the subsequent put for the same
    // (log group, log stream) pair.
    // Ref: https://forums.aws.amazon.com/message.jspa?messageID=676799
    private nextSequenceToken: string = null;

    constructor(
        private readonly session: SessionProxy,
        private readonly logGroupName: string,
        private readonly logStreamName: string,
        private readonly platformLambdaLogger: LambdaLogger,
        private readonly metricsPublisherProxy: MetricsPublisherProxy,
        ...logFilters: readonly LogFilter[]
    ) {
        super(...logFilters);
        this.refreshClient();
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client('CloudWatchLogs', options) as CloudWatchLogs;
    }

    protected async publishMessage(message: string): Promise<void> {
        try {
            if (this.skipLogging()) {
                return;
            }
            if (!this.client) {
                throw Error(
                    'CloudWatchLogs client was not initialized. You must call refreshClient() first.'
                );
            }
            const currentTime = new Date(Date.now());
            const record: InputLogEvent = {
                message,
                timestamp: Math.round(currentTime.getTime()),
            };
            const logEventsParams: PutLogEventsRequest = {
                logGroupName: this.logGroupName,
                logStreamName: this.logStreamName,
                logEvents: [record],
            };
            if (this.nextSequenceToken) {
                logEventsParams.sequenceToken = this.nextSequenceToken;
            }

            const putLogRequest = this.client.putLogEvents(logEventsParams);
            if (putLogRequest.httpRequest) {
                putLogRequest.httpRequest.headers['x-amzn-logs-format'] = 'json/emf';
            }

            const response: PutLogEventsResponse = await putLogRequest.promise();
            this.platformLambdaLogger.log('Response from "putLogEvents"', response);
            this.nextSequenceToken = response?.nextSequenceToken || null;
            return;
        } catch (err) {
            const errorCode = err.code || err.name;
            this.platformLambdaLogger.log(
                `Error from "putLogEvents" with sequence token ${this.nextSequenceToken}`,
                err
            );
            if (
                errorCode === 'DataAlreadyAcceptedException' ||
                errorCode === 'InvalidSequenceTokenException' ||
                errorCode === 'ThrottlingException'
            ) {
                this.nextSequenceToken = null;
                // Delay to avoid throttling
                await delay(1);
                try {
                    const response: DescribeLogStreamsResponse = await this.client
                        .describeLogStreams({
                            logGroupName: this.logGroupName,
                            logStreamNamePrefix: this.logStreamName,
                            limit: 1,
                        })
                        .promise();
                    this.platformLambdaLogger.log(
                        'Response from "describeLogStreams"',
                        response
                    );
                    if (response.logStreams?.length) {
                        const logStream = response.logStreams[0] as LogStream;
                        this.nextSequenceToken = logStream.uploadSequenceToken;
                    }
                } catch (err) {
                    this.platformLambdaLogger.log(
                        'Error from "describeLogStreams"',
                        err
                    );
                }
                return;
            } else {
                this.platformLambdaLogger.log(
                    `An error occurred while putting log events [${message}] to resource owner account, with error: ${err.toString()}`
                );
                this.emitMetricsForLoggingFailure(err);
                throw err;
            }
        }
    }

    private skipLogging(): boolean {
        return !this.logStreamName;
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(Date.now()),
                err
            );
        }
    }
}

export class CloudWatchLogHelper {
    private client: CloudWatchLogs;

    constructor(
        private readonly session: SessionProxy,
        private logGroupName: string,
        private logStreamName: string,
        private readonly platformLambdaLogger: LambdaLogger,
        private readonly metricsPublisherProxy: MetricsPublisherProxy
    ) {
        if (!this.logStreamName) {
            this.logStreamName = uuidv4();
        } else {
            this.logStreamName = logStreamName.replace(/:/g, '__');
        }
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client('CloudWatchLogs', options) as CloudWatchLogs;
    }

    public async prepareLogStream(): Promise<string> {
        if (!this.client) {
            throw Error(
                'CloudWatchLogs client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            if (!(await this.doesLogGroupExist())) {
                await this.createLogGroup();
            }
            return await this.createLogStream();
        } catch (err) {
            this.log(
                `Initializing logging group setting failed with error: ${err.toString()}`
            );
            this.emitMetricsForLoggingFailure(err);
        }
        return null;
    }

    private async doesLogGroupExist(): Promise<boolean> {
        let logGroupExists = false;
        try {
            const response = await this.client
                .describeLogGroups({
                    logGroupNamePrefix: this.logGroupName,
                })
                .promise();
            this.log('Response from "describeLogGroups"', response);
            if (response.logGroups?.length) {
                logGroupExists = response.logGroups.some((logGroup) => {
                    return logGroup.logGroupName === this.logGroupName;
                });
            }
            this.log(
                `Log group with name ${this.logGroupName} does${
                    logGroupExists ? '' : ' not'
                } exist in resource owner account.`
            );
        } catch (err) {
            this.log(err);
            this.emitMetricsForLoggingFailure(err);
            logGroupExists = false;
        }
        return Promise.resolve(logGroupExists);
    }

    private async createLogGroup(): Promise<string> {
        try {
            this.log(`Creating Log group with name ${this.logGroupName}.`);
            const response = await this.client
                .createLogGroup({
                    logGroupName: this.logGroupName,
                })
                .promise();
            this.log('Response from "createLogGroup"', response);
        } catch (err) {
            const errorCode = err.code || err.name;
            if (errorCode !== 'ResourceAlreadyExistsException') {
                throw err;
            }
        }
        return Promise.resolve(this.logGroupName);
    }

    private async createLogStream(): Promise<string> {
        try {
            this.log(
                `Creating Log stream with name ${this.logStreamName} for log group ${this.logGroupName}.`
            );
            const response = await this.client
                .createLogStream({
                    logGroupName: this.logGroupName,
                    logStreamName: this.logStreamName,
                })
                .promise();
            this.log('Response from "createLogStream"', response);
        } catch (err) {
            const errorCode = err.code || err.name;
            if (errorCode !== 'ResourceAlreadyExistsException') {
                throw err;
            }
        }
        return Promise.resolve(this.logStreamName);
    }

    private log(message?: any, ...optionalParams: any[]): void {
        if (this.platformLambdaLogger) {
            this.platformLambdaLogger.log(message, ...optionalParams);
        }
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(Date.now()),
                err
            );
        }
    }
}

export class S3LogPublisher extends LogPublisher {
    private client: S3;

    constructor(
        private readonly session: SessionProxy,
        private readonly bucketName: string,
        private readonly folderName: string,
        private readonly platformLambdaLogger: LambdaLogger,
        private readonly metricsPublisherProxy: MetricsPublisherProxy,
        ...logFilters: readonly LogFilter[]
    ) {
        super(...logFilters);
        this.refreshClient();
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client('S3', options) as S3;
    }

    protected async publishMessage(message: string): Promise<void> {
        try {
            if (this.skipLogging()) {
                return;
            }
            if (!this.client) {
                throw Error(
                    'S3 client was not initialized. You must call refreshClient() first.'
                );
            }
            const currentTime = new Date(Date.now());
            const timestamp = currentTime.toISOString().replace(/[^a-z0-9]/gi, '');
            const putObjectParams: PutObjectRequest = {
                Bucket: this.bucketName,
                Key: `${this.folderName}/${timestamp}-${Math.floor(
                    Math.random() * 100
                )}.json`,
                ContentType: 'application/json',
                Body: message,
            };

            const response = await this.client.putObject(putObjectParams).promise();
            this.platformLambdaLogger.log('Response from "putObject"', response);
            return;
        } catch (err) {
            this.platformLambdaLogger.log(
                `An error occurred while putting log events [${message}] to resource owner account, with error: ${err.toString()}`
            );
            this.emitMetricsForLoggingFailure(err);
            throw err;
        }
    }

    private skipLogging(): boolean {
        return !this.bucketName;
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(Date.now()),
                err
            );
        }
    }
}

export class S3LogHelper {
    private client: S3;

    constructor(
        private readonly session: SessionProxy,
        private bucketName: string,
        private folderName: string,
        private readonly platformLambdaLogger: LambdaLogger,
        private readonly metricsPublisherProxy: MetricsPublisherProxy
    ) {
        if (!this.folderName) {
            this.folderName = uuidv4();
        }
        this.folderName = this.folderName.replace(/[^a-z0-9!_'.*()/-]/gi, '_');
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client('S3', options) as S3;
    }

    public async prepareFolder(): Promise<string> {
        if (!this.client) {
            throw Error(
                'S3 client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            await this.createBucket();
            return await this.createFolder();
        } catch (err) {
            this.log(
                `Initializing S3 bucket and folder failed with error: ${err.toString()}`
            );
            this.emitMetricsForLoggingFailure(err);
        }
        return null;
    }

    private async createBucket(): Promise<void> {
        try {
            this.log(`Creating S3 bucket with name ${this.bucketName}.`);
            const response = await this.client
                .createBucket({
                    Bucket: this.bucketName,
                })
                .promise();
            this.log('Response from "createBucket"', response);
        } catch (err) {
            const errorCode = err.code || err.name;
            if (
                errorCode !== 'BucketAlreadyOwnedByYou' &&
                errorCode !== 'BucketAlreadyExists'
            ) {
                throw err;
            }
        }
    }

    private async createFolder(): Promise<string> {
        try {
            this.log(
                `Creating folder with name ${this.folderName} for bucket ${this.bucketName}.`
            );
            const folderItems = await this.client
                .listObjectsV2({
                    Bucket: this.bucketName,
                    Prefix: `${this.folderName}/`,
                })
                .promise();
            this.log('Response from "listObjects"', folderItems);
            if (!folderItems.Contents?.length) {
                const response = await this.client
                    .putObject({
                        Bucket: this.bucketName,
                        Key: `${this.folderName}/`,
                        ContentLength: 0,
                    })
                    .promise();
                this.log('Response from "putObject"', response);
            }
        } catch (err) {
            throw err;
        }
        return Promise.resolve(this.folderName);
    }

    private log(message?: any, ...optionalParams: any[]): void {
        if (this.platformLambdaLogger) {
            this.platformLambdaLogger.log(message, ...optionalParams);
        }
    }

    private async emitMetricsForLoggingFailure(err: Error): Promise<void> {
        if (this.metricsPublisherProxy) {
            await this.metricsPublisherProxy.publishLogDeliveryExceptionMetric(
                new Date(Date.now()),
                err
            );
        }
    }
}

/**
 * Proxies logging requests to the default LambdaLogger (CloudWatch Logs)
 */
export class LoggerProxy implements Logger {
    private readonly logPublishers = new Array<LogPublisher>();
    private readonly queue = new Array<PromiseFunction>();

    public addLogPublisher(logPublisher: LogPublisher): void {
        this.logPublishers.push(logPublisher);
    }

    public async processQueue(): Promise<void> {
        await promiseSequential(this.queue);
        console.debug('Log delivery finalized.');
        this.queue.length = 0;
    }

    public log(message?: any, ...optionalParams: any[]): void {
        const formatted = format(message, ...optionalParams);
        this.logPublishers.forEach((logPublisher: LogPublisher) => {
            this.queue.push(() => {
                return logPublisher.publishLogEvent(formatted).catch((err: Error) => {
                    console.log(err);
                    return logPublisher.publishLogEvent(formatted).catch(console.log);
                });
            });
        });
    }
}

/**
 * @deprecated
 */
// export class ProviderLogHandler {
//     private static instance: ProviderLogHandler;
//     public emitter: LogEmitter;
//     public client: CloudWatchLogs;
//     public sequenceToken: string = null;
//     public accountId: string;
//     public groupName: string;
//     public stream: string;
//     public logger: Console;
//     public clientS3: S3;
//     private stack: Array<PromiseFunction> = [];
//     private isProcessing = false;

//     /**
//      * The ProviderLogHandler's constructor should always be private to prevent direct
//      * construction calls with the `new` operator.
//      */
//     private constructor(options: LogOptions) {
//         this.accountId = options.accountId;
//         this.groupName = options.groupName;
//         this.stream = options.stream.replace(/:/g, '__');
//         this.client = options.session.client('CloudWatchLogs') as CloudWatchLogs;
//         this.clientS3 = null;
//         // Attach the logger methods to localized event emitter.
//         const emitter = new LogEmitter();
//         this.emitter = emitter;
//         const logger = options.logger || global.console;
//         this.logger = logger;
//         this.emitter.on('log', (...args: any[]) => {
//             // this.logger.debug('Emitting log event...');
//         });
//         // Create maps of each logger method and then alias that.
//         Object.entries(this.logger).forEach(([key, val]) => {
//             if (typeof val === 'function') {
//                 if (['log', 'error', 'warn', 'info'].includes(key)) {
//                     this.logger[key as 'log' | 'error' | 'warn' | 'info'] = (
//                         ...args: any[]
//                     ): void => {
//                         if (!this.isProcessing) {
//                             const logLevel = key.toUpperCase();
//                             // Add log level when not present
//                             if (
//                                 args.length &&
//                                 (typeof args[0] !== 'string' ||
//                                     args[0]
//                                         .substring(0, logLevel.length)
//                                         .toUpperCase() !== logLevel)
//                             ) {
//                                 args.unshift(logLevel);
//                             }
//                             this.stack.push(() =>
//                                 this.deliverLog(args).catch(this.logger.debug)
//                             );
//                             // For adding other event watchers later.
//                             setImmediate(() => {
//                                 this.emitter.emit('log', ...args);
//                             });
//                         } else {
//                             this.logger.debug(
//                                 'Logs are being delivered at the moment...'
//                             );
//                         }

//                         // Calls the logger method.
//                         val.apply(this.logger, args);
//                     };
//                 }
//             }
//         });
//     }

//     private async initialize(): Promise<void> {
//         this.sequenceToken = null;
//         this.stack = [];
//         try {
//             await this.deliverLogCloudWatch(['Initialize CloudWatch']);
//             this.clientS3 = null;
//         } catch (err) {
//             // If unable to deliver logs to CloudWatch, S3 will be used as a fallback.
//             this.clientS3 = new S3({
//                 region: this.client.config.region,
//                 accessKeyId: this.client.config.accessKeyId,
//                 secretAccessKey: this.client.config.secretAccessKey,
//                 sessionToken: this.client.config.sessionToken,
//             });
//             await this.deliverLogS3([err]);
//         }
//     }

//     /**
//      * The static method that controls the access to the singleton instance.
//      *
//      * This implementation let you subclass the ProviderLogHandler class while keeping
//      * just one instance of each subclass around.
//      */
//     public static getInstance(): ProviderLogHandler {
//         if (!ProviderLogHandler.instance) {
//             return null;
//         }
//         return ProviderLogHandler.instance;
//     }

//     public static async setup(
//         request: HandlerRequest,
//         providerSession?: SessionProxy
//     ): Promise<boolean> {
//         const logGroup: string = request.requestData?.providerLogGroupName;
//         let streamName = `${request.awsAccountId}-${request.region}`;
//         if (request.stackId && request.requestData?.logicalResourceId) {
//             streamName = `${request.stackId}/${request.requestData.logicalResourceId}`;
//         }
//         let logHandler = ProviderLogHandler.getInstance();
//         try {
//             if (providerSession && logGroup) {
//                 if (logHandler) {
//                     // This is a re-used lambda container, log handler is already setup, so
//                     // we just refresh the client with new creds.
//                     logHandler.client = providerSession.client(
//                         'CloudWatchLogs'
//                     ) as CloudWatchLogs;
//                 } else {
//                     logHandler = ProviderLogHandler.instance = new ProviderLogHandler({
//                         accountId: request.awsAccountId,
//                         groupName: logGroup,
//                         stream: streamName,
//                         session: providerSession,
//                     });
//                 }
//                 await logHandler.initialize();
//             }
//         } catch (err) {
//             console.debug('Error on ProviderLogHandler setup:', err);
//             logHandler = null;
//         }
//         return Promise.resolve(logHandler !== null);
//     }

//     @boundMethod
//     public async processLogs(): Promise<void> {
//         this.isProcessing = true;
//         if (this.stack.length > 0) {
//             this.stack.push(() => this.deliverLog(['Log delivery finalized.']));
//         }
//         await promiseSequential(this.stack);
//         this.stack = [];
//         this.isProcessing = false;
//     }

//     private async createLogGroup(): Promise<void> {
//         try {
//             const response = await this.client
//                 .createLogGroup({
//                     logGroupName: this.groupName,
//                 })
//                 .promise();
//             this.logger.debug('Response from "createLogGroup"', response);
//         } catch (err) {
//             const errorCode = err.code || err.name;
//             if (errorCode !== 'ResourceAlreadyExistsException') {
//                 throw err;
//             }
//         }
//     }

//     private async createLogStream(): Promise<void> {
//         try {
//             const response = await this.client
//                 .createLogStream({
//                     logGroupName: this.groupName,
//                     logStreamName: this.stream,
//                 })
//                 .promise();
//             this.logger.debug('Response from "createLogStream"', response);
//         } catch (err) {
//             const errorCode = err.code || err.name;
//             if (errorCode !== 'ResourceAlreadyExistsException') {
//                 throw err;
//             }
//         }
//     }

//     private async putLogEvents(record: InputLogEvent): Promise<PutLogEventsResponse> {
//         if (!record.timestamp) {
//             const currentTime = new Date(Date.now());
//             record.timestamp = Math.round(currentTime.getTime());
//         }
//         const logEventsParams: PutLogEventsRequest = {
//             logGroupName: this.groupName,
//             logStreamName: this.stream,
//             logEvents: [record],
//         };
//         if (this.sequenceToken) {
//             logEventsParams.sequenceToken = this.sequenceToken;
//         }
//         try {
//             const response: PutLogEventsResponse = await this.client
//                 .putLogEvents(logEventsParams)
//                 .promise();
//             this.sequenceToken = response?.nextSequenceToken || null;
//             this.logger.debug('Response from "putLogEvents"', response);
//             return response;
//         } catch (err) {
//             const errorCode = err.code || err.name;
//             this.logger.debug(
//                 `Error from "putLogEvents" with sequence token ${this.sequenceToken}`,
//                 err
//             );
//             if (
//                 errorCode === 'DataAlreadyAcceptedException' ||
//                 errorCode === 'InvalidSequenceTokenException'
//             ) {
//                 this.sequenceToken = null;
//                 // Delay to avoid throttling
//                 await delay(1);
//                 try {
//                     const response: DescribeLogStreamsResponse = await this.client
//                         .describeLogStreams({
//                             logGroupName: this.groupName,
//                             logStreamNamePrefix: this.stream,
//                             limit: 1,
//                         })
//                         .promise();
//                     this.logger.debug('Response from "describeLogStreams"', response);
//                     if (response.logStreams && response.logStreams.length) {
//                         const logStream = response.logStreams[0] as LogStream;
//                         this.sequenceToken = logStream.uploadSequenceToken;
//                     }
//                 } catch (err) {
//                     this.logger.debug('Error from "describeLogStreams"', err);
//                 }
//             } else {
//                 throw err;
//             }
//         }
//     }

//     @boundMethod
//     private async deliverLogCloudWatch(
//         messages: any[]
//     ): Promise<PutLogEventsResponse | void> {
//         const currentTime = new Date(Date.now());
//         const record: InputLogEvent = {
//             message: JSON.stringify({ messages }),
//             timestamp: Math.round(currentTime.getTime()),
//         };
//         try {
//             const response = await this.putLogEvents(record);
//             return response;
//         } catch (err) {
//             const errorCode = err.code || err.name;
//             this.logger.debug('Error from "deliverLogCloudWatch"', err);
//             if (errorCode === 'ResourceNotFoundException') {
//                 if (err.message.includes('log group does not exist')) {
//                     await this.createLogGroup();
//                 }
//                 await this.createLogStream();
//             } else if (
//                 errorCode !== 'DataAlreadyAcceptedException' &&
//                 errorCode !== 'InvalidSequenceTokenException'
//             ) {
//                 throw err;
//             }
//             try {
//                 const response = await this.putLogEvents(record);
//                 return response;
//             } catch (err) {
//                 // Additional retry for sequence token error
//                 if (this.sequenceToken) {
//                     return this.putLogEvents(record);
//                 }
//                 throw err;
//             }
//         }
//     }

//     private async createBucket(): Promise<void> {
//         try {
//             const response = await this.clientS3
//                 .createBucket({
//                     Bucket: `${this.groupName}-${this.accountId}`,
//                 })
//                 .promise();
//             this.logger.debug('Response from "createBucket"', response);
//         } catch (err) {
//             const errorCode = err.code || err.name;
//             if (
//                 errorCode !== 'BucketAlreadyOwnedByYou' &&
//                 errorCode !== 'BucketAlreadyExists'
//             ) {
//                 throw err;
//             }
//         }
//     }

//     private async putLogObject(body: any): Promise<PutObjectOutput> {
//         const currentTime = new Date(Date.now());
//         const bucket = `${this.groupName}-${this.accountId}`;
//         const folder = this.stream.replace(/[^a-z0-9!_'.*()/-]/gi, '_');
//         const timestamp = currentTime.toISOString().replace(/[^a-z0-9]/gi, '');
//         const params: PutObjectRequest = {
//             Bucket: bucket,
//             Key: `${folder}/${timestamp}-${Math.floor(Math.random() * 100)}.json`,
//             ContentType: 'application/json',
//             Body: JSON.stringify(body),
//         };
//         try {
//             const response: PutObjectOutput = await this.clientS3
//                 .putObject(params)
//                 .promise();
//             this.logger.debug('Response from "putLogObject"', response);
//             return response;
//         } catch (err) {
//             this.logger.debug('Error from "putLogObject"', err);
//             throw err;
//         }
//     }

//     @boundMethod
//     private async deliverLogS3(messages: any[]): Promise<PutObjectOutput> {
//         const body = {
//             groupName: this.groupName,
//             stream: this.stream,
//             messages,
//         };
//         try {
//             const response = await this.putLogObject(body);
//             return response;
//         } catch (err) {
//             const errorCode = err.code || err.name;
//             const statusCode = err.statusCode || 0;
//             this.logger.debug('Error from "deliverLogS3"', err);
//             if (
//                 errorCode === 'NoSuchBucket' ||
//                 (statusCode >= 400 && statusCode < 500)
//             ) {
//                 if (err.message.includes('bucket does not exist')) {
//                     await this.createBucket();
//                 }
//                 return this.putLogObject(body);
//             } else {
//                 throw err;
//             }
//         }
//     }

//     @boundMethod
//     private async deliverLog(
//         messages: any[]
//     ): Promise<PutLogEventsResponse | PutObjectOutput | void> {
//         if (this.clientS3) {
//             return this.deliverLogS3(messages);
//         }
//         return this.deliverLogCloudWatch(messages);
//     }
// }
