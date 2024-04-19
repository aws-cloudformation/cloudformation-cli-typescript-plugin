import { format, inspect, InspectOptions } from 'util';
import CloudWatchLogs, {
    LogStream,
    InputLogEvent,
} from 'aws-sdk/clients/cloudwatchlogs';
import { ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import S3, { PutObjectRequest } from 'aws-sdk/clients/s3';
import { v4 as uuidv4 } from 'uuid';

import { AwsTaskWorkerPool, ExtendedClient, SessionProxy } from './proxy';
import { MetricsPublisherProxy } from './metrics';
import { delay, ProgressTracker, Queue } from './utils';

type Console = globalThis.Console;
export type LambdaLogger = Partial<Console>;

export interface Logger {
    /**
     * Log a message to the default provider on this runtime.
     *
     * @param message The primary message.
     * @param optionalParams All additional used as substitution values.
     */
    log(message?: any, ...optionalParams: any[]): void;
}

export interface LogFilter {
    applyFilter(rawInput: string): string;
}

export abstract class LogPublisher {
    private logFilters: LogFilter[];

    constructor(
        protected readonly workerPool?: AwsTaskWorkerPool,
        ...filters: readonly LogFilter[]
    ) {
        this.logFilters = Array.from(filters);
    }

    protected abstract publishMessage(message: string, eventTime?: Date): Promise<void>;

    /**
     * Redact or scrub loggers in someway to help prevent leaking of certain
     * information.
     */
    private filterMessage(message: string): string {
        let toReturn: string = message;
        this.logFilters.forEach((filter: LogFilter) => {
            toReturn = filter.applyFilter(toReturn);
        });
        return toReturn;
    }

    public addFilter(filter: LogFilter): void {
        if (filter) {
            this.logFilters.push(filter);
        }
    }

    public async publishLogEvent(message: string, eventTime?: Date): Promise<void> {
        if (!eventTime) {
            eventTime = new Date(Date.now());
        }
        await this.publishMessage(this.filterMessage(message), eventTime);
    }
}

/**
 * Publisher that will send the logs to stdout through Console instance,
 * as that is the default behavior for Node.js Lambda
 */
export class LambdaLogPublisher extends LogPublisher {
    constructor(
        private readonly logger: LambdaLogger,
        ...logFilters: readonly LogFilter[]
    ) {
        super(null, ...logFilters);
    }

    protected async publishMessage(message: string): Promise<void> {
        return Promise.resolve(this.logger.log('%s\n', message));
    }
}

/**
 * Publisher that will send the logs to CloudWatch.
 * It requires the following IAM permissions:
 *   * logs:DescribeLogStreams
 *   * logs:PutLogEvents
 */
export class CloudWatchLogPublisher extends LogPublisher {
    private client: ExtendedClient<CloudWatchLogs>;
    private queue = new Queue();

    // Note: PutLogEvents returns a result that includes a sequence number.
    // That same sequence number must be used in the subsequent put for the same
    // (log group, log stream) pair.
    // Ref: https://forums.aws.amazon.com/message.jspa?messageID=676799
    private nextSequenceToken: string = null;

    constructor(
        private readonly session: SessionProxy,
        private readonly logGroupName: string,
        private readonly logStreamName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy,
        protected readonly workerPool?: AwsTaskWorkerPool,
        ...logFilters: readonly LogFilter[]
    ) {
        super(workerPool, ...logFilters);
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client(CloudWatchLogs, options, this.workerPool);
    }

    protected async publishMessage(message: string, eventTime: Date): Promise<void> {
        if (this.skipLogging()) {
            return;
        }
        if (!this.client) {
            throw Error(
                'CloudWatchLogs client was not initialized. You must call refreshClient() first.'
            );
        }
        return await this.queue.enqueue(async () => {
            const record: InputLogEvent = {
                message,
                timestamp: Math.round(eventTime.getTime()),
            };
            try {
                this.nextSequenceToken = await this.putLogEvents(
                    record,
                    this.nextSequenceToken
                );
                return;
            } catch (err) {
                if (err instanceof Error) {
                    // @ts-expect-error fix in aws sdk v3
                    const errorCode = err.code || err.name;
                    this.platformLogger.log(
                        `Error from "putLogEvents" with sequence token ${this.nextSequenceToken}`,
                        JSON.stringify(err)
                    );
                    if (
                        errorCode === 'DataAlreadyAcceptedException' ||
                        errorCode === 'InvalidSequenceTokenException' ||
                        errorCode === 'ThrottlingException'
                    ) {
                        await delay(0.25);
                        const result = (err.message || '').match(
                            /sequencetoken( is)?: (.+)/i
                        );
                        if (result?.length === 3 && result[2]) {
                            this.nextSequenceToken = result[2];
                        } else {
                            await this.populateSequenceToken();
                        }
                        await this.emitMetricsForLoggingFailure(err);
                        // @ts-expect-error fix in aws sdk v3
                        err.retryable = true;
                        err.message = `Publishing this log event should be retried. ${err.message}`;
                    } else {
                        this.platformLogger.log(
                            `An error occurred while putting log events [${message}] to resource owner account, with error: ${err.toString()}`
                        );
                    }
                    await this.emitMetricsForLoggingFailure(err);
                }
                throw err;
            }
        });
    }

    private async putLogEvents(
        record: InputLogEvent,
        sequenceToken: string = undefined
    ): Promise<string> {
        // Delay to avoid throttling
        await delay(0.25);
        const response = await this.client.makeRequestPromise(
            'putLogEvents',
            {
                logGroupName: this.logGroupName,
                logStreamName: this.logStreamName,
                logEvents: [record],
                sequenceToken,
            },
            { 'X-Amzn-Logs-Format': 'json/emf' }
        );
        this.platformLogger.log('Response from "putLogEvents"', response);
        if (response?.rejectedLogEventsInfo) {
            throw new Error(JSON.stringify(response.rejectedLogEventsInfo));
        }
        return response?.nextSequenceToken || null;
    }

    async populateSequenceToken(): Promise<string> {
        this.nextSequenceToken = null;
        try {
            const response = await this.client.makeRequestPromise(
                'describeLogStreams',
                {
                    logGroupName: this.logGroupName,
                    logStreamNamePrefix: this.logStreamName,
                    limit: 1,
                }
            );
            this.platformLogger.log('Response from "describeLogStreams"', response);
            if (response.logStreams?.length) {
                const logStream = response.logStreams[0] as LogStream;
                this.nextSequenceToken = logStream.uploadSequenceToken;
            }
        } catch (err) {
            this.platformLogger.log('Error from "describeLogStreams"', err);
        }
        return this.nextSequenceToken;
    }

    private skipLogging(): boolean {
        return !(this.logGroupName && this.logStreamName);
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
 * Class to help setup a CloudWatch log group and stream.
 * It requires the following IAM permissions:
 *   * logs:CreateLogGroup
 *   * logs:CreateLogStream
 *   * logs:DescribeLogGroups
 */
export class CloudWatchLogHelper {
    private client: ExtendedClient<CloudWatchLogs>;

    constructor(
        private readonly session: SessionProxy,
        private logGroupName: string,
        private logStreamName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy,
        protected readonly workerPool?: AwsTaskWorkerPool
    ) {
        if (!this.logStreamName) {
            this.logStreamName = uuidv4();
        } else {
            this.logStreamName = logStreamName.replace(/:/g, '__');
        }
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client(CloudWatchLogs, options, this.workerPool);
    }

    public async prepareLogStream(): Promise<string | null> {
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
            if (err instanceof Error) {
                this.log(
                    `Initializing logging group setting failed with error: ${err.toString()}`
                );
                await this.emitMetricsForLoggingFailure(err);
            }
        }
        return Promise.resolve(null);
    }

    private async doesLogGroupExist(): Promise<boolean> {
        let logGroupExists = false;
        try {
            const response = await this.client.makeRequestPromise('describeLogGroups', {
                logGroupNamePrefix: this.logGroupName,
            });
            this.log('Response from "describeLogGroups"', response);
            if (response.logGroups?.length) {
                logGroupExists = response.logGroups.some((logGroup) => {
                    return logGroup.logGroupName === this.logGroupName;
                });
            }
        } catch (err) {
            if (err instanceof Error) {
                this.log(err);
                await this.emitMetricsForLoggingFailure(err);
            }
        }
        this.log(
            `Log group with name ${this.logGroupName} does${
                logGroupExists ? '' : ' not'
            } exist in resource owner account.`
        );
        return Promise.resolve(logGroupExists);
    }

    private async createLogGroup(): Promise<string> {
        try {
            this.log(`Creating Log group with name ${this.logGroupName}.`);
            const response = await this.client.makeRequestPromise('createLogGroup', {
                logGroupName: this.logGroupName,
            });
            this.log('Response from "createLogGroup"', response);
        } catch (err) {
            // @ts-expect-error fix in aws sdk v3
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
            const response = await this.client.makeRequestPromise('createLogStream', {
                logGroupName: this.logGroupName,
                logStreamName: this.logStreamName,
            });
            this.log('Response from "createLogStream"', response);
        } catch (err) {
            // @ts-expect-error fix in aws sdk v3
            const errorCode = err.code || err.name;
            if (errorCode !== 'ResourceAlreadyExistsException') {
                throw err;
            }
        }
        return Promise.resolve(this.logStreamName);
    }

    private log(message?: any, ...optionalParams: any[]): void {
        if (this.platformLogger) {
            this.platformLogger.log(message, ...optionalParams);
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
 * Publisher that will send the logs to a S3 bucket.
 * It requires the following IAM permissions:
 *   * s3:PutObject
 */
export class S3LogPublisher extends LogPublisher {
    private client: ExtendedClient<S3>;

    constructor(
        private readonly session: SessionProxy,
        private readonly bucketName: string,
        private readonly folderName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy,
        protected readonly workerPool?: AwsTaskWorkerPool,
        ...logFilters: readonly LogFilter[]
    ) {
        super(workerPool, ...logFilters);
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client(S3, options, this.workerPool);
    }

    protected async publishMessage(message: string, eventTime: Date): Promise<void> {
        if (this.skipLogging()) {
            return;
        }
        if (!this.client) {
            throw Error(
                'S3 client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            const timestamp = eventTime.toISOString().replace(/[^a-z0-9]/gi, '');
            const putObjectParams: PutObjectRequest = {
                Bucket: this.bucketName,
                Key: `${this.folderName}/${timestamp}-${Math.floor(
                    Math.random() * 100
                )}.log`,
                ContentType: 'text/plain',
                Body: message,
            };
            const response = await this.client.makeRequestPromise(
                'putObject',
                putObjectParams
            );
            this.platformLogger.log('Response from "putObject"', response);
            return;
        } catch (err) {
            if (err instanceof Error) {
                this.platformLogger.log(
                    `An error occurred while putting log events [${message}] to resource owner account, with error: ${err.toString()}`
                );
                await this.emitMetricsForLoggingFailure(err);
                throw err;
            }
        }
    }

    private skipLogging(): boolean {
        return !(this.bucketName && this.folderName);
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
 * Class to help setup a S3 bucket with a default folder inside.
 * It requires the following IAM permissions:
 *   * s3:CreateBucket
 *   * s3:GetObject
 *   * s3:ListBucket
 */
export class S3LogHelper {
    private client: ExtendedClient<S3>;

    constructor(
        private readonly session: SessionProxy,
        private bucketName: string,
        private folderName: string,
        private readonly platformLogger: Logger,
        private readonly metricsPublisherProxy?: MetricsPublisherProxy,
        protected readonly workerPool?: AwsTaskWorkerPool
    ) {
        if (!this.folderName) {
            this.folderName = uuidv4();
        }
        this.folderName = this.folderName.replace(/[^a-z0-9!_'.*()/-]/gi, '_');
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client(S3, options, this.workerPool);
    }

    public async prepareFolder(): Promise<string | null> {
        if (!this.client) {
            throw Error(
                'S3 client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            const folderExists = await this.doesFolderExist();
            if (folderExists === null) {
                await this.createBucket();
            }
            if (folderExists === true) {
                return this.folderName;
            } else {
                return await this.createFolder();
            }
        } catch (err) {
            if (err instanceof Error) {
                this.log(
                    `Initializing S3 bucket and folder failed with error: ${err.toString()}`
                );
                await this.emitMetricsForLoggingFailure(err);
            }
        }
        return null;
    }

    private async doesFolderExist(): Promise<boolean | null> {
        let folderExists = false;
        try {
            const response = await this.client.makeRequestPromise('listObjectsV2', {
                Bucket: this.bucketName,
                Prefix: `${this.folderName}/`,
            });
            this.log('Response from "listObjects"', response);
            if (response.Contents?.length) {
                folderExists = true;
            }
            this.log(
                `S3 folder with name ${this.folderName} does${
                    folderExists ? '' : ' not'
                } exist in bucket ${this.bucketName}.`
            );
            return Promise.resolve(folderExists);
        } catch (err) {
            // @ts-expect-error fix in aws sdk v3
            const errorCode = err.code || err.name;
            if (errorCode === 'NoSuchBucket') {
                this.log(
                    `S3 bucket with name ${this.bucketName} does exist in resource owner account.`
                );
            }
            this.log(err);
            // @ts-expect-error fix in aws sdk v3
            await this.emitMetricsForLoggingFailure(err);
            return Promise.resolve(null);
        }
    }

    private async createBucket(): Promise<string> {
        try {
            this.log(`Creating S3 bucket with name ${this.bucketName}.`);
            const response = await this.client.makeRequestPromise('createBucket', {
                Bucket: this.bucketName,
            });
            this.log('Response from "createBucket"', response);
        } catch (err) {
            // @ts-expect-error fix in aws sdk v3
            const errorCode = err.code || err.name;
            if (
                errorCode !== 'BucketAlreadyOwnedByYou' &&
                errorCode !== 'BucketAlreadyExists'
            ) {
                throw err;
            }
        }
        return Promise.resolve(this.bucketName);
    }

    private async createFolder(): Promise<string> {
        try {
            this.log(
                `Creating folder with name ${this.folderName} for bucket ${this.bucketName}.`
            );
            const response = await this.client.makeRequestPromise('putObject', {
                Bucket: this.bucketName,
                Key: `${this.folderName}/`,
                ContentLength: 0,
            });
            this.log('Response from "putObject"', response);
        } catch (err) {
            throw err;
        }
        return Promise.resolve(this.folderName);
    }

    private log(message?: any, ...optionalParams: any[]): void {
        if (this.platformLogger) {
            this.platformLogger.log(message, ...optionalParams);
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
 * Proxies logging requests to the publisher that have been added.
 * By default LambdaLogger.
 */
export class LoggerProxy implements Logger {
    private readonly logPublishers = new Array<LogPublisher>();
    readonly tracker = new ProgressTracker();

    constructor(defaultOptions: InspectOptions = {}) {
        // Allow passing Node.js inspect options,
        // and change default depth from 4 to 10
        inspect.defaultOptions = {
            ...inspect.defaultOptions,
            depth: 10,
            ...defaultOptions,
        };
    }

    addLogPublisher(logPublisher: LogPublisher): void {
        if (logPublisher) {
            this.logPublishers.push(logPublisher);
        }
    }

    addFilter(filter: LogFilter): void {
        this.logPublishers.forEach((logPublisher: LogPublisher) => {
            logPublisher.addFilter(filter);
        });
    }

    async waitCompletion(): Promise<boolean> {
        try {
            this.tracker.end();
            await this.tracker.waitCompletion();
        } catch (err) {
            console.error(err);
        }
        return Promise.resolve(true);
    }

    log(message?: any, ...optionalParams: any[]): void {
        const formatted = format(message, ...optionalParams);
        const eventTime = new Date(Date.now());
        for (const logPublisher of this.logPublishers) {
            this.tracker.addSubmitted();
            (async () => {
                try {
                    await logPublisher.publishLogEvent(formatted, eventTime);
                    this.tracker.addCompleted();
                } catch (err) {
                    if (err instanceof Error) {
                        // @ts-expect-error fix in aws sdk v3
                        if (err.retryable === true) {
                            try {
                                await logPublisher.publishLogEvent(formatted, eventTime);
                                this.tracker.addCompleted();
                            } catch (err) {
                                console.error(err);
                                this.tracker.addFailed();
                            }
                        } else {
                            this.tracker.addFailed();
                        }
                    } else {
                        this.tracker.addFailed();
                    }
                }
            })();
        }
    }
}
