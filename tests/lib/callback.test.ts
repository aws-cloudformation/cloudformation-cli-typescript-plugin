import CloudFormation from 'aws-sdk/clients/cloudformation';
import { reportProgress } from '../../src/callback';
import { SessionProxy } from '../../src/proxy';
import {
    BaseResourceModel,
    HandlerErrorCode,
    OperationStatus,
} from '../../src/interface';


const mockResult = (output: any): jest.Mock => {
    return jest.fn().mockReturnValue({
        promise: jest.fn().mockResolvedValue(output),
    });
};

const IDENTIFIER = 'f3390613-b2b5-4c31-a4c6-66813dff96a6';

jest.mock('aws-sdk/clients/cloudformation');
jest.mock('uuid', () => {
    return {
        v4: (): string => IDENTIFIER,
    };
});

describe('when getting callback', () => {

    let session: SessionProxy;
    let recordHandlerProgress: jest.Mock;

    beforeEach(() => {
        recordHandlerProgress = mockResult({
            ResponseMetadata: {RequestId: 'mock-request'},
        });
        const cfn = (CloudFormation as unknown) as jest.Mock;
        cfn.mockImplementation(() => {
            const returnValue = {
                recordHandlerProgress,
            };
            return {
                ...returnValue,
                makeRequest: (operation: string, params?: {[key: string]: any}): any => {
                    return returnValue[operation](params);
                },
            };
        });
        session = new SessionProxy({});
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    test('report progress minimal', () => {
        reportProgress({
            session: session,
            bearerToken: '123',
            operationStatus: OperationStatus.InProgress,
            currentOperationStatus: OperationStatus.InProgress,
            message: '',
        });
        expect(recordHandlerProgress).toHaveBeenCalledTimes(1);
        expect(recordHandlerProgress).toHaveBeenCalledWith({
            BearerToken: '123',
            OperationStatus: 'IN_PROGRESS',
            CurrentOperationStatus: 'IN_PROGRESS',
            StatusMessage: '',
            ClientRequestToken: IDENTIFIER,
        });
    });

    test('report progress full', () => {
        reportProgress({
            session: session,
            bearerToken: '123',
            errorCode: HandlerErrorCode.InternalFailure,
            operationStatus: OperationStatus.Failed,
            currentOperationStatus: OperationStatus.InProgress,
            resourceModel: {} as BaseResourceModel,
            message: 'test message',
        });
        expect(recordHandlerProgress).toHaveBeenCalledTimes(1);
        expect(recordHandlerProgress).toHaveBeenCalledWith({
            BearerToken: '123',
            OperationStatus: 'FAILED',
            CurrentOperationStatus: 'IN_PROGRESS',
            StatusMessage: 'test message',
            ResourceModel: '{}',
            ErrorCode: 'InternalFailure',
            ClientRequestToken: IDENTIFIER,
        });
    });
});
