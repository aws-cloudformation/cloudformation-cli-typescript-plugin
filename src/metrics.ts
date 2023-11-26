import { CloudWatch, Dimension } from '@aws-sdk/client-cloudwatch';

import { Logger } from './log-delivery';
import { SessionProxy } from './proxy';
import { Action, MetricTypes, StandardUnit } from './interface';
import { BaseHandlerException } from './exceptions';
import { Queue } from './utils';

const METRIC_NAMESPACE_ROOT = 'AWS/CloudFormation';

type DimensionName = string;
export type DimensionRecord = Record<DimensionName, string>;

export function formatDimensions(dimensions: DimensionRecord): Array<Dimension> {
    const formatted: Array<Dimension> = [];
    for (const key in dimensions) {
        const value = dimensions[key];
        const dimension: Dimension = {
            Name: key,
            Value: value,
        };
        formatted.push(dimension);
    }
    return formatted;
}

/**
 * A cloudwatch based metric publisher.
 * Given a resource type and session,
 * this publisher will publish metrics to CloudWatch.
 * Can be used with the MetricsPublisherProxy.
 */
export class MetricsPublisher {
    private resourceNamespace: string;
    private client: CloudWatch;

    constructor(
        private readonly session: SessionProxy,
        private readonly logger: Logger,
        private readonly resourceType: string
    ) {
        this.resourceNamespace = resourceType.replace(/::/g, '/');
    }

    public refreshClient(options?: ConstructorParameters<typeof CloudWatch>): void {
        this.client = this.session.client(CloudWatch, options);
    }

    async publishMetric(
        metricName: MetricTypes,
        dimensions: DimensionRecord,
        unit: StandardUnit,
        value: number,
        timestamp: Date
    ): Promise<void> {
        if (!this.client) {
            throw Error(
                'CloudWatch client was not initialized. You must call refreshClient() first.'
            );
        }
        try {
            const metric = await this.client.putMetricData({
                Namespace: `${METRIC_NAMESPACE_ROOT}/${this.resourceNamespace}`,
                MetricData: [
                    {
                        MetricName: metricName,
                        Dimensions: formatDimensions(dimensions),
                        Unit: unit,
                        Timestamp: timestamp,
                        Value: value,
                    },
                ],
            });
            this.log('Response from "putMetricData"', metric);
        } catch (err: any) {
            if (err.retryable) {
                throw err;
            } else {
                this.log(`An error occurred while publishing metrics: ${err?.message}`);
            }
        }
    }

    /**
     * Publishes an exception based metric
     */
    async publishExceptionMetric(
        timestamp: Date,
        action: Action,
        error: Error
    ): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyExceptionType:
                (error as BaseHandlerException).errorCode || error.constructor.name,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerException,
            dimensions,
            StandardUnit.Count,
            1.0,
            timestamp
        );
    }

    /**
     * Publishes a metric related to invocations
     */
    async publishInvocationMetric(timestamp: Date, action: Action): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerInvocationCount,
            dimensions,
            StandardUnit.Count,
            1.0,
            timestamp
        );
    }

    /**
     * Publishes an duration metric
     */
    async publishDurationMetric(
        timestamp: Date,
        action: Action,
        milliseconds: number
    ): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        return this.publishMetric(
            MetricTypes.HandlerInvocationDuration,
            dimensions,
            StandardUnit.Milliseconds,
            milliseconds,
            timestamp
        );
    }

    /**
     * Publishes an log delivery exception metric
     */
    async publishLogDeliveryExceptionMetric(
        timestamp: Date,
        error: Error
    ): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: 'ProviderLogDelivery',
            DimensionKeyExceptionType:
                (error as BaseHandlerException).errorCode || error.constructor.name,
            DimensionKeyResourceType: this.resourceType,
        };
        try {
            return await this.publishMetric(
                MetricTypes.HandlerException,
                dimensions,
                StandardUnit.Count,
                1.0,
                timestamp
            );
        } catch (err) {
            this.log(err);
        }
        return Promise.resolve(null);
    }

    private log(message?: any, ...optionalParams: any[]): void {
        if (this.logger) {
            this.logger.log(message, ...optionalParams);
        }
    }
}

/**
 * A proxy for publishing metrics to multiple publishers.
 * Iterates over available publishers and publishes.
 */
export class MetricsPublisherProxy {
    private publishers: Array<MetricsPublisher> = [];
    private queue = new Queue();

    /**
     * Adds a metrics publisher to the list of publishers
     */
    addMetricsPublisher(metricsPublisher?: MetricsPublisher): void {
        if (metricsPublisher) {
            this.publishers.push(metricsPublisher);
        }
    }

    /**
     * Publishes an exception based metric to the list of publishers
     */
    async publishExceptionMetric(
        timestamp: Date,
        action: Action,
        error: Error
    ): Promise<void> {
        for (const publisher of this.publishers) {
            await this.queue.enqueue(() =>
                publisher.publishExceptionMetric(timestamp, action, error)
            );
        }
    }

    /**
     * Publishes a metric related to invocations to the list of publishers
     */
    async publishInvocationMetric(timestamp: Date, action: Action): Promise<void> {
        for (const publisher of this.publishers) {
            await this.queue.enqueue(() =>
                publisher.publishInvocationMetric(timestamp, action)
            );
        }
    }

    /**
     * Publishes a duration metric to the list of publishers
     */
    async publishDurationMetric(
        timestamp: Date,
        action: Action,
        milliseconds: number
    ): Promise<void> {
        for (const publisher of this.publishers) {
            await this.queue.enqueue(() =>
                publisher.publishDurationMetric(timestamp, action, milliseconds)
            );
        }
    }

    /**
     * Publishes a log delivery exception metric to the list of publishers
     */
    async publishLogDeliveryExceptionMetric(
        timestamp: Date,
        error: Error
    ): Promise<void> {
        for (const publisher of this.publishers) {
            await this.queue.enqueue(() =>
                publisher.publishLogDeliveryExceptionMetric(timestamp, error)
            );
        }
    }
}
