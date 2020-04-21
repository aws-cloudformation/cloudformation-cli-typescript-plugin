import CloudWatch, { Dimension } from 'aws-sdk/clients/cloudwatch';

import { SessionProxy } from './proxy';
import { Action, MetricTypes, StandardUnit } from './interface';


const LOGGER = console;
const METRIC_NAMESPACE_ROOT = 'AWS/CloudFormation';

export function formatDimensions(dimensions: Map<string, string>): Array<Dimension> {
    const formatted: Array<Dimension> = [];
    dimensions.forEach((value: string, key: string) => {
        formatted.push({
            Name: key,
            Value: value,
        });
    });
    return formatted;
}

export class MetricPublisher {
    public client: CloudWatch;

    constructor (session: SessionProxy, public namespace: string) {
        this.client = session.client('CloudWatch') as CloudWatch;
    }

    async publishMetric(
        metricName: MetricTypes,
        dimensions: Map<string, string>,
        unit: StandardUnit,
        value: number,
        timestamp: Date,
    ): Promise<void> {
        try {
            const metric = await this.client.putMetricData({
                Namespace: this.namespace,
                MetricData: [{
                    MetricName: metricName,
                    Dimensions: formatDimensions(dimensions),
                    Unit: unit,
                    Timestamp: timestamp,
                    Value: value,
                }],
            }).promise();
            LOGGER.debug('Response from "putMetricData"', metric);
        } catch(err) {
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

    async publishExceptionMetric(timestamp: Date, action: Action, error: Error): Promise<any> {
        const dimensions = new Map<string, string>();
        dimensions.set('DimensionKeyActionType', action);
        dimensions.set('DimensionKeyExceptionType', error['errorCode'] || error.constructor.name);
        dimensions.set('DimensionKeyResourceType', this.resourceType);
        const promises: Array<Promise<void>> = this.publishers.map((publisher: MetricPublisher) => {
            return publisher.publishMetric(
                MetricTypes.HandlerException,
                dimensions,
                StandardUnit.Count,
                1.0,
                timestamp,
            );
        });
        return await Promise.all(promises);
    }

    async publishInvocationMetric(timestamp: Date, action: Action): Promise<any> {
        const dimensions = new Map<string, string>();
        dimensions.set('DimensionKeyActionType', action);
        dimensions.set('DimensionKeyResourceType', this.resourceType);
        const promises: Array<Promise<void>> = this.publishers.map((publisher: MetricPublisher) => {
            return publisher.publishMetric(
                MetricTypes.HandlerInvocationCount,
                dimensions,
                StandardUnit.Count,
                1.0,
                timestamp,
            );
        });
        return await Promise.all(promises);
    }

    async publishDurationMetric(timestamp: Date, action: Action, milliseconds: number): Promise<any> {
        const dimensions = new Map<string, string>();
        dimensions.set('DimensionKeyActionType', action);
        dimensions.set('DimensionKeyResourceType', this.resourceType);
        const promises: Array<Promise<void>> = this.publishers.map((publisher: MetricPublisher) => {
            return publisher.publishMetric(
                MetricTypes.HandlerInvocationDuration,
                dimensions,
                StandardUnit.Milliseconds,
                milliseconds,
                timestamp,
            );
        });
        return await Promise.all(promises);
    }

    async publishLogDeliveryExceptionMetric(timestamp: Date, error: any): Promise<any> {
        const dimensions = new Map<string, string>();
        dimensions.set('DimensionKeyActionType', 'ProviderLogDelivery');
        dimensions.set('DimensionKeyExceptionType', error['errorCode'] || error.constructor.name);
        dimensions.set('DimensionKeyResourceType', this.resourceType);
        const promises: Array<Promise<void>> = this.publishers.map((publisher: MetricPublisher) => {
            return publisher.publishMetric(
                MetricTypes.HandlerException,
                dimensions,
                StandardUnit.Count,
                1.0,
                timestamp,
            );
        });
        return await Promise.all(promises);
    }
}
