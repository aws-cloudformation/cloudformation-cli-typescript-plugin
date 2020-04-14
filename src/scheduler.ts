import { v4 as uuidv4 } from 'uuid';
import CloudWatchEvents from 'aws-sdk/clients/cloudwatchevents';

import { SessionProxy } from './proxy';
import { HandlerRequest, minToCron } from './utils';


const LOGGER = console;

/**
 * Schedule a re-invocation of the executing handler no less than 1 minute from
 * now
 *
 * @param session AWS session where to retrieve CloudWatchEvents client
 * @param functionArn the ARN of the Lambda function to be invoked
 * @param minutesFromNow the minimum minutes from now that the re-invocation
 *            will occur. CWE provides only minute-granularity
 * @param handlerRequest additional context which the handler can provide itself
 *            for re-invocation
 */
export const rescheduleAfterMinutes = async (
    session: SessionProxy,
    functionArn: string,
    minutesFromNow: number,
    handlerRequest: HandlerRequest,
): Promise<void> => {
    const client: CloudWatchEvents = session.client('CloudWatchEvents') as CloudWatchEvents;
    const cron = minToCron(Math.max(minutesFromNow, 1));
    const identifier = uuidv4();
    const ruleName = `reinvoke-handler-${identifier}`;
    const targetId = `reinvoke-target-${identifier}`;
    handlerRequest.requestContext.cloudWatchEventsRuleName = ruleName;
    handlerRequest.requestContext.cloudWatchEventsTargetId = targetId;
    const jsonRequest = JSON.stringify(handlerRequest);
    LOGGER.debug(`Scheduling re-invoke at ${cron} (${identifier})`);
    await client.putRule({
        Name: ruleName,
        ScheduleExpression: cron,
        State: 'ENABLED',
    }).promise();
    await client.putTargets({
        Rule: ruleName,
        Targets: [{
            Id: targetId,
            Arn: functionArn,
            Input: jsonRequest,
        }],
    }).promise();
}

/**
 * After a re-invocation, the CWE rule which generated the reinvocation should
 * be scrubbed
 *
 * @param session AWS session where to retrieve CloudWatchEvents client
 * @param ruleName the name of the CWE rule which triggered a re-invocation
 * @param targetId the target of the CWE rule which triggered a re-invocation
 */
export const cleanupCloudwatchEvents = async (
    session: SessionProxy, ruleName: string, targetId: string
): Promise<void> => {
    const client: CloudWatchEvents = session.client('CloudWatchEvents') as CloudWatchEvents;
    try {
        if (targetId && ruleName) {
            await client.removeTargets({
                Rule: ruleName,
                Ids: [targetId],
            }).promise();
        }
    } catch(err) {
        LOGGER.error(
            `Error cleaning CloudWatchEvents Target (targetId=${targetId}): ${err.message}`
        );
    }

    try {
        if (ruleName) {
            await client.deleteRule({
                Name: ruleName,
                Force: true,
            }).promise();
        }
    } catch(err) {
        LOGGER.error(
            `Error cleaning CloudWatchEvents Rule (ruleName=${ruleName}): ${err.message}`
        );
    }
}
