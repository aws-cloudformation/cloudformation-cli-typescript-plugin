import { v4 as uuidv4 } from 'uuid';

import {
    SessionProxy,
} from './proxy';
import { BaseResourceModel, OperationStatus, Response } from './interface';
import { KitchenSinkEncoder } from './utils';


const LOG = console;

interface ProgressOptions extends Response<BaseResourceModel> {
    session: SessionProxy,
    currentOperationStatus?: OperationStatus,
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
    const client = session.client('CloudFormation');

    const request: { [key: string]: any; } = {
        BearerToken: bearerToken,
        OperationStatus: operationStatus,
        StatusMessage: message,
        ClientRequestToken: uuidv4(),
    };
    if (resourceModel) {
        request.ResourceModel = JSON.stringify(resourceModel);
    }
    if (errorCode) {
        request.ErrorCode = errorCode;
    }
    if (currentOperationStatus) {
        request['CurrentOperationStatus'] = currentOperationStatus;
        const response: { [key: string]: any; } = await client.makeRequest('recordHandlerProgress', request).promise()
        const requestId = response['ResponseMetadata']['RequestId'];
        LOG.info(`Record Handler Progress with Request Id ${requestId} and Request: ${request}`);
    }
}
