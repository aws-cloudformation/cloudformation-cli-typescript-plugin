import { format } from 'util';
import { AWSError, Request } from 'aws-sdk';
import CloudWatchLogs, {
    DescribeLogStreamsResponse,
    LogStream,
    InputLogEvent,
    PutLogEventsRequest,
    PutLogEventsResponse,
} from 'aws-sdk/clients/cloudwatchlogs';
import { ServiceConfigurationOptions } from 'aws-sdk/lib/service';
import S3, { PutObjectRequest } from 'aws-sdk/clients/s3';
import { v4 as uuidv4 } from 'uuid';

import { SessionProxy } from './proxy';
import { MetricsPublisherProxy } from './metrics';
import { delay } from './utils';

type Console = globalThis.Console;
export type LambdaLogger = Partial<Console>;
type PromiseFunction = () => Promise<any>;

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

    protected abstract publishMessage(message: string, eventTime?: Date): Promise<void>;

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

    public publishLogEvent(message: string, eventTime?: Date): Promise<void> {
        if (!eventTime) {
            eventTime = new Date(Date.now());
        }
        return this.publishMessage(this.filterMessage(message), eventTime);
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
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client('CloudWatchLogs', options) as CloudWatchLogs;
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
        try {
            // Delay to avoid throttling
            await delay(0.25);
            const record: InputLogEvent = {
                message,
                timestamp: Math.round(eventTime.getTime()),
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
            putLogRequest.on(
                'build',
                (req: Request<PutLogEventsResponse, AWSError>) => {
                    req.httpRequest.headers['X-Amzn-Logs-Format'] = 'json/emf';
                }
            );

            const response: PutLogEventsResponse = await putLogRequest.promise();
            this.platformLambdaLogger.log('Response from "putLogEvents"', response);
            this.nextSequenceToken = response?.nextSequenceToken || null;
            if (response.rejectedLogEventsInfo) {
                throw new Error(JSON.stringify(response.rejectedLogEventsInfo));
            }
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
                    await this.emitMetricsForLoggingFailure(err);
                }
                return Promise.reject('Publishing this log event should be retried.');
            } else {
                this.platformLambdaLogger.log(
                    `An error occurred while putting log events [${message}] to resource owner account, with error: ${err.toString()}`
                );
                await this.emitMetricsForLoggingFailure(err);
                throw err;
            }
        }
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
            this.log(
                `Initializing logging group setting failed with error: ${err.toString()}`
            );
            await this.emitMetricsForLoggingFailure(err);
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
        } catch (err) {
            this.log(err);
            await this.emitMetricsForLoggingFailure(err);
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
    }

    public refreshClient(options?: ServiceConfigurationOptions): void {
        this.client = this.session.client('S3', options) as S3;
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
            await this.emitMetricsForLoggingFailure(err);
            throw err;
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
            this.log(
                `Initializing S3 bucket and folder failed with error: ${err.toString()}`
            );
            await this.emitMetricsForLoggingFailure(err);
        }
        return null;
    }

    private async doesFolderExist(): Promise<boolean | null> {
        let folderExists = false;
        try {
            const response = await this.client
                .listObjectsV2({
                    Bucket: this.bucketName,
                    Prefix: `${this.folderName}/`,
                })
                .promise();
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
            const errorCode = err.code || err.name;
            if (errorCode === 'NoSuchBucket') {
                this.log(
                    `S3 bucket with name ${this.bucketName} does exist in resource owner account.`
                );
            }
            this.log(err);
            await this.emitMetricsForLoggingFailure(err);
            return Promise.resolve(null);
        }
    }

    private async createBucket(): Promise<string> {
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
        return Promise.resolve(this.bucketName);
    }

    private async createFolder(): Promise<string> {
        try {
            this.log(
                `Creating folder with name ${this.folderName} for bucket ${this.bucketName}.`
            );
            const response = await this.client
                .putObject({
                    Bucket: this.bucketName,
                    Key: `${this.folderName}/`,
                    ContentLength: 0,
                })
                .promise();
            this.log('Response from "putObject"', response);
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
        for (const key in this.queue) {
            try {
                await this.queue[key]();
            } catch (err) {
                console.error(err);
                try {
                    await this.queue[key]();
                } catch (err) {
                    console.error(err);
                }
            }
        }
        console.debug('Log delivery finalized.');
        this.queue.length = 0;
    }

    public log(message?: any, ...optionalParams: any[]): void {
        const formatted = format(message, ...optionalParams);
        const eventTime = new Date(Date.now());
        this.logPublishers.forEach((logPublisher: LogPublisher) => {
            this.queue.push(() => logPublisher.publishLogEvent(formatted, eventTime));
        });
    }
}
