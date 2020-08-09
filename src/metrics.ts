import CloudWatch, { Dimension, DimensionName } from 'aws-sdk/clients/cloudwatch';

import { SessionProxy } from './proxy';
import { Action, MetricTypes, StandardUnit } from './interface';
import { BaseHandlerException } from './exceptions';

const LOGGER = console;
const METRIC_NAMESPACE_ROOT = 'AWS/CloudFormation';

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

export class MetricPublisher {
    public client: CloudWatch;

    constructor(session: SessionProxy, public namespace: string) {
        this.client = session.client('CloudWatch') as CloudWatch;
    }

    async publishMetric(
        metricName: MetricTypes,
        dimensions: DimensionRecord,
        unit: StandardUnit,
        value: number,
        timestamp: Date
    ): Promise<void> {
        try {
            const metric = await this.client
                .putMetricData({
                    Namespace: this.namespace,
                    MetricData: [
                        {
                            MetricName: metricName,
                            Dimensions: formatDimensions(dimensions),
                            Unit: unit,
                            Timestamp: timestamp,
                            Value: value,
                        },
                    ],
                })
                .promise();
            LOGGER.debug('Response from "putMetricData"', metric);
        } catch (err) {
            LOGGER.error(`An error occurred while publishing metrics: ${err.message}`);
        }
    }
}

export class MetricsPublisherProxy {
    public namespace: string;
    private publishers: Array<MetricPublisher>;

    constructor(public accountId: string, public resourceType: string) {
        this.namespace = MetricsPublisherProxy.makeNamespace(accountId, resourceType);
        this.resourceType = resourceType;
        this.publishers = [];
    }

    static makeNamespace(accountId: string, resourceType: string): string {
        const suffix = resourceType.replace(/::/g, '/');
        return `${METRIC_NAMESPACE_ROOT}/${accountId}/${suffix}`;
    }

    addMetricsPublisher(session?: SessionProxy): void {
        if (session) {
            this.publishers.push(new MetricPublisher(session, this.namespace));
        }
    }

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
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricPublisher) => {
                return publisher.publishMetric(
                    MetricTypes.HandlerException,
                    dimensions,
                    StandardUnit.Count,
                    1.0,
                    timestamp
                );
            }
        );
        return await Promise.all(promises);
    }

    async publishInvocationMetric(timestamp: Date, action: Action): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricPublisher) => {
                return publisher.publishMetric(
                    MetricTypes.HandlerInvocationCount,
                    dimensions,
                    StandardUnit.Count,
                    1.0,
                    timestamp
                );
            }
        );
        return await Promise.all(promises);
    }

    async publishDurationMetric(
        timestamp: Date,
        action: Action,
        milliseconds: number
    ): Promise<any> {
        const dimensions: DimensionRecord = {
            DimensionKeyActionType: action,
            DimensionKeyResourceType: this.resourceType,
        };
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricPublisher) => {
                return publisher.publishMetric(
                    MetricTypes.HandlerInvocationDuration,
                    dimensions,
                    StandardUnit.Milliseconds,
                    milliseconds,
                    timestamp
                );
            }
        );
        return await Promise.all(promises);
    }

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
        const promises: Array<Promise<void>> = this.publishers.map(
            (publisher: MetricPublisher) => {
                return publisher.publishMetric(
                    MetricTypes.HandlerException,
                    dimensions,
                    StandardUnit.Count,
                    1.0,
                    timestamp
                );
            }
        );
        return await Promise.all(promises);
    }
}
