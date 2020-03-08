import {
    Action,
    BaseResource,
    handlerAction,
    HandlerErrorCode,
    OperationStatus,
    Optional,
    ProgressEvent,
    ResourceHandlerRequest,
    SessionProxy,
} from '{{lib_name}}';
import * as exceptions from '{{lib_name}}/dist/exceptions';
import { ResourceModel } from './models';

// Use this logger to forward log messages to CloudWatch Logs.
const LOG = console;

class Resource<T = ResourceModel> extends BaseResource<T> {

    @handlerAction(Action.Create)
    public create(
        session: Optional<SessionProxy>,
        request: ResourceHandlerRequest<ResourceModel>,
        callbackContext: Map<string, any>,
    ): ProgressEvent {
        const model: ResourceModel = request.desiredResourceState;
        // @ts-ignore
        const progress: ProgressEvent = ProgressEvent.builder({
            status: OperationStatus.InProgress,
            resourceModel: model,
        }).build();
        // TODO: put code here

        // Example:
        try {
            if (session instanceof SessionProxy) {
                const client = session.client('s3');
            }
            // Setting Status to success will signal to cfn that the operation is complete
            progress.status = OperationStatus.Success;
        } catch(err) {
            LOG.log(err);
            throw new exceptions.InternalFailure(err.message);
        }
        return progress;
    }

    @handlerAction(Action.Update)
    public update(
        session: Optional<SessionProxy>,
        request: ResourceHandlerRequest<ResourceModel>,
        callbackContext: Map<string, any>,
    ): ProgressEvent {
        const model: ResourceModel = request.desiredResourceState;
        // @ts-ignore
        const progress: ProgressEvent = ProgressEvent.builder({
            status: OperationStatus.InProgress,
            resourceModel: model,
        }).build();
        // TODO: put code here
        return progress;
    }

    @handlerAction(Action.Delete)
    public delete(
        session: Optional<SessionProxy>,
        request: ResourceHandlerRequest<ResourceModel>,
        callbackContext: Map<string, any>,
    ): ProgressEvent {
        const model: ResourceModel = request.desiredResourceState;
        // @ts-ignore
        const progress: ProgressEvent = ProgressEvent.builder({
            status: OperationStatus.InProgress,
            resourceModel: model,
        }).build();
        // TODO: put code here
        return progress;
    }

    @handlerAction(Action.Read)
    public read(
        session: Optional<SessionProxy>,
        request: ResourceHandlerRequest<ResourceModel>,
        callbackContext: Map<string, any>,
    ): ProgressEvent {
        const model: ResourceModel = request.desiredResourceState;
        // TODO: put code here
        // @ts-ignore
        ProgressEvent.progress()
        const progress: ProgressEvent = ProgressEvent.builder({
            status: OperationStatus.Success,
            resourceModel: model,
        }).build();
        return progress;
    }

    @handlerAction(Action.List)
    public list(
        session: Optional<SessionProxy>,
        request: ResourceHandlerRequest<ResourceModel>,
        callbackContext: Map<string, any>,
    ): ProgressEvent {
        // TODO: put code here
        // @ts-ignore
        const progress: ProgressEvent = ProgressEvent.builder({
            status: OperationStatus.Success,
            resourceModels: [],
        }).build();
        return progress;
    }
}

export const resource = new Resource();

export const testEntrypoint = resource.testEntrypoint;
