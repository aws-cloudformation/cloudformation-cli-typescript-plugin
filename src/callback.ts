import { v4 as uuidv4 } from 'uuid';
import CloudFormation from 'aws-sdk/clients/cloudformation';

import { SessionProxy } from './proxy';
import { BaseResourceModel, CfnResponse, OperationStatus } from './interface';

const LOGGER = console;

interface ProgressOptions extends CfnResponse<BaseResourceModel> {
    session: SessionProxy;
    currentOperationStatus?: OperationStatus;
}

export async function reportProgress(options: ProgressOptions): Promise<void> {
    const {
        session,
        bearerToken,
        errorCode,
        operationStatus,
        currentOperationStatus,
        resourceModel,
        message,
    } = options;
    const client: CloudFormation = session.client('CloudFormation') as CloudFormation;

    const request: CloudFormation.RecordHandlerProgressInput = {
        BearerToken: bearerToken,
        OperationStatus: operationStatus,
        StatusMessage: message,
        ClientRequestToken: uuidv4(),
    } as CloudFormation.RecordHandlerProgressInput;
    if (resourceModel) {
        request.ResourceModel = JSON.stringify(resourceModel);
    }
    if (errorCode) {
        request.ErrorCode = errorCode;
    }
    if (currentOperationStatus) {
        request.CurrentOperationStatus = currentOperationStatus;
        LOGGER.debug('Record Handler Progress Request:', request);
        const response: { [key: string]: any } = await client
            .recordHandlerProgress(request)
            .promise();
        let requestId = '';
        if (response['ResponseMetadata']) {
            requestId = response.ResponseMetadata.RequestId;
        }
        LOGGER.debug(
            `Record handler progress with Request Id ${requestId} and response:`,
            response
        );
    }
}
