import CloudWatchEvents from 'aws-sdk/clients/cloudwatchevents';
import awsUtil = require('aws-sdk/lib/util');

import { cleanupCloudwatchEvents, rescheduleAfterMinutes } from '../../src/scheduler';
import { SessionProxy } from '../../src/proxy';
import { RequestContext } from '../../src/interface';
import * as utils from '../../src/utils';


const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output)
    });
};

const IDENTIFIER: string = 'f3390613-b2b5-4c31-a4c6-66813dff96a6';

jest.mock('aws-sdk/clients/cloudwatchevents');
jest.mock('uuid', () => {
    return {
        v4: () => IDENTIFIER
    };
});

describe('when getting scheduler', () => {

    let session: SessionProxy;
    let handlerRequest: utils.HandlerRequest;
    let cwEvents: jest.Mock;
    let spyConsoleError: jest.SpyInstance;
    let spyMinToCron: jest.SpyInstance;
    let mockPutRule: jest.Mock;
    let mockPutTargets: jest.Mock;
    let mockRemoveTargets: jest.Mock;
    let mockDeleteRule: jest.Mock;

    beforeEach(() => {
        spyConsoleError = jest.spyOn(global.console, 'error').mockImplementation(() => {});
        spyMinToCron = jest.spyOn(utils, 'minToCron')
            .mockReturnValue('cron(30 16 21 11 ? 2019)');
        mockPutRule = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        mockPutTargets = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        mockRemoveTargets = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});
        mockDeleteRule = mockResult({ ResponseMetadata: { RequestId: 'mock-request' }});

        cwEvents = (CloudWatchEvents as unknown) as jest.Mock;
        cwEvents.mockImplementation(() => {
            const returnValue = {
                deleteRule: mockDeleteRule,
                putRule: mockPutRule,
                putTargets: mockPutTargets,
                removeTargets: mockRemoveTargets,
            };
            return {
                ...returnValue,
                makeRequest: (operation: string, params?: {[key: string]: any}) => {
                    return returnValue[operation](params);
                }
            };
        });
        session = new SessionProxy({});
        session['client'] = cwEvents;

        handlerRequest = new utils.HandlerRequest()
        handlerRequest.requestContext = {} as RequestContext<Map<string, any>>;
        handlerRequest.toJSON = jest.fn(() => new Object());
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('reschedule after minutes zero', async () => {
        // if called with zero, should call cron with a 1
        await rescheduleAfterMinutes(session, 'arn:goes:here', 0, handlerRequest);

        expect(cwEvents).toHaveBeenCalledTimes(1);
        expect(cwEvents).toHaveBeenCalledWith('CloudWatchEvents');
        expect(spyMinToCron).toHaveBeenCalledTimes(1);
        expect(spyMinToCron).toHaveBeenCalledWith(1);
    });

    test('reschedule after minutes not zero', async () => {
        // if called with another number, should use that
        await rescheduleAfterMinutes(session, 'arn:goes:here', 2, handlerRequest);

        expect(cwEvents).toHaveBeenCalledTimes(1);
        expect(cwEvents).toHaveBeenCalledWith('CloudWatchEvents');
        expect(spyMinToCron).toHaveBeenCalledTimes(1);
        expect(spyMinToCron).toHaveBeenCalledWith(2);
    });

    test('reschedule after minutes success', async () => {
        await rescheduleAfterMinutes(session, 'arn:goes:here', 2, handlerRequest);

        expect(cwEvents).toHaveBeenCalledTimes(1);
        expect(cwEvents).toHaveBeenCalledWith('CloudWatchEvents');
        expect(mockPutRule).toHaveBeenCalledTimes(1);
        expect(mockPutRule).toHaveBeenCalledWith({
            Name: `reinvoke-handler-${IDENTIFIER}`,
            ScheduleExpression: 'cron(30 16 21 11 ? 2019)',
            State: 'ENABLED',
        });
        expect(mockPutTargets).toHaveBeenCalledTimes(1);
        expect(mockPutTargets).toHaveBeenCalledWith({
            Rule: `reinvoke-handler-${IDENTIFIER}`,
            Targets: [
                {
                    Id: `reinvoke-target-${IDENTIFIER}`,
                    Arn: 'arn:goes:here',
                    Input: '{}',
                }
            ],
        });
    });

    test('cleanup cloudwatch events empty', async () => {
        // cleanup should silently pass if rule/target are empty
        await cleanupCloudwatchEvents(session, '', '');

        expect(cwEvents).toHaveBeenCalledTimes(1);
        expect(cwEvents).toHaveBeenCalledWith('CloudWatchEvents');
        expect(mockRemoveTargets).toHaveBeenCalledTimes(0);
        expect(mockDeleteRule).toHaveBeenCalledTimes(0);
        expect(spyConsoleError).toHaveBeenCalledTimes(0);
    });

    test('cleanup cloudwatch events success', async () => {
        // when rule_name and target_id are provided we should call events client and not
        // log errors if the deletion succeeds
        await cleanupCloudwatchEvents(session, 'rulename', 'targetid');

        expect(spyConsoleError).toHaveBeenCalledTimes(0);
        expect(cwEvents).toHaveBeenCalledTimes(1);
        expect(cwEvents).toHaveBeenCalledWith('CloudWatchEvents');
        expect(mockRemoveTargets).toHaveBeenCalledTimes(1);
        expect(mockDeleteRule).toHaveBeenCalledTimes(1);
        expect(mockPutRule).toHaveBeenCalledTimes(0);
        expect(spyConsoleError).toHaveBeenCalledTimes(0);
    });

    test('cleanup cloudwatch events client error', async () => {
        // cleanup should catch and log client failures
        const error = awsUtil.error(new Error(), { code: '1' });
        mockRemoveTargets.mockImplementation(() => {throw error});
        mockDeleteRule.mockImplementation(() => {throw error});

        await cleanupCloudwatchEvents(session, 'rulename', 'targetid');

        expect(cwEvents).toHaveBeenCalledTimes(1);
        expect(cwEvents).toHaveBeenCalledWith('CloudWatchEvents');
        expect(spyConsoleError).toHaveBeenCalledTimes(2);
        expect(mockRemoveTargets).toHaveBeenCalledTimes(1);
        expect(mockDeleteRule).toHaveBeenCalledTimes(1);
        expect(mockPutTargets).toHaveBeenCalledTimes(0);
    });
});
