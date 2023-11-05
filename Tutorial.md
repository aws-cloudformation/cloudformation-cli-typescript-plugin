# Walkthrough: Develop a Dummy Resource Provider in Typescript<a name="resource-type-walkthrough"></a>

In this walkthrough, we'll use the CloudFormation CLI and the Typescript plugin to create a sample resource provider, `Testing::Unicorn::Maker`\. This includes modeling the schema, developing the handlers to testing those handlers, all the way to submitting to the CloudFormation registry\. We'll be coding our new resource provider in Typescript, and using the `us-west-2` region\.

## Prerequisites<a name="resource-type-walkthrough-prereqs"></a>

For purposes of this walkthrough, it is assumed you have already installed a node and npm versions as well as the [aws-cli](https://github.com/aws/aws-cli/tree/v2), the [cloudformation-cli](https://github.com/aws-cloudformation/cloudformation-cli) and the [Typescript plugin](https://github.com/eduardomourar/cloudformation-cli-typescript-plugin).

## Create the Resource Provider Development Project<a name="resource-type-walkthrough-model"></a>

Before we can actually design and implement our resource provider, we'll need to generate a new resource type project\.

### Initiate the project<a name="resource-type-walkthrough-model-initiate"></a>

1. Use the `init` command to create your resource provider project and generate the files it requires\.

    ```
    $ cfn init
    Initializing new project
    ```

2. The `init` command launches a wizard that walks you through setting up the project, including specifying the resource name\. For this walkthrough, specify `Testing::Unicorn::Maker`\.

    ```
    Enter resource type identifier (Organization::Service::Resource)
    >> Testing::Unicorn::Maker
    ```

   The wizard then enables you to select the appropriate language plugin\. Select Typescript\.

    ```
    Select a language for code generation:
    [1] go
    [2] java
    [3] python36
    [4] python37
    [5] typescript
    (enter an integer):
    >> 5
    ```

3. Finally, you will be prompted for the use of Docker. Select Yes\.

    ```
    Use docker for platform-independent packaging (Y/n)?
    This is highly recommended unless you are experienced
    with cross-platform Typescript packaging.
    >> Y
    Initialized a new project in /Users/<user_id>/Projects/UnicornMaker
    ```

Intiating the project includes generating the files needed to develop the resource provider\. For example:

```
$ ls -1
README.md
docs
example_inputs
package.json
resource-role.yaml
rpdk.log
sam-tests
src
template.yml
testing-unicorn-maker.json
tsconfig.json
```

## Setup Development Project<a name="resource-type-walkthrough-model-setup"></a>

Update the `package.json` file by changing the description and dependencies to:

```
.
.
.
"description": "Unicorn-maker is a complete example of a Cloudformation provider. This resource is built in multiple languages, to get you up and running creating Cloudformation custom resources.",
.
.
.
"dependencies": {
    "cfn-rpdk": "https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/releases/download/v0.3.3/cfn-rpdk-0.3.3.tgz",
    "class-transformer": "^0.3.1",
    "node-fetch": "^3.0.0-beta.4"
},
.
.
.
```

Run `npm install`

## Model the Resource Provider<a name="resource-type-walkthrough-model-schema"></a>

When you initiate the resource provider project, an example resource provider schema file is included to help you start modeling your resource provider\. This is a JSON file named after your resource, and contains an example of a typical resource provider schema\. In the case of our example resource, the schema file is named `testing-unicorn-maker.json`\.

1. In your IDE, open `testing-unicorn-maker.json`\.

1. Paste the following schema in place of the default example schema currently in the file\.

   This schema defines a resource, `Testing::Unicorn::Maker`, that creates unicorns using [crudcrud](https://crudcrud.com/). The resource itself contains thre properties, only two of which can be set by users: name, and color. The other property, uid, is read-only, meaning it cannot be set by users, but will be assigned during resource creation. These property also serve as identifier for the resource when it is provisioned.

    ```
    {
        "typeName": "Testing::Unicorn::Maker",
        "description": "An example resource that creates unicorns.",
        "sourceUrl": "The URL of the source code for this resource, if public.",
        "properties": {
            "uid": {
                "description": "The ID of the majestic animal",
                "pattern": "^[a-z0-9]+$",
                "type": "string"
            },
            "name": {
                "description": "The name of the majestic animal",
                "type": "string",
                "pattern": "^[a-zA-Z0-9]+$",
                "minLength": 3,
                "maxLength": 250
            },
            "color": {
                "description": "The color of the majestic animal",
                "type": "string",
                "pattern": "^[a-zA-Z0-9]+$",
                "minLength": 3,
                "maxLength": 250
            }
        },
        "additionalProperties": false,
        "required": [
            "name",
            "color"
        ],
        "readOnlyProperties": [
            "/properties/uid"
        ],
        "primaryIdentifier": [
            "/properties/uid"
        ],
        "handlers": {
            "create": {
                "permissions": []
            },
            "read": {
                "permissions": []
            },
            "update": {
                "permissions": []
            },
            "delete": {
                "permissions": []
            },
            "list": {
                "permissions": []
            }
        }
    }
    ```

1. Update the auto\-generated files in the resource provider package so that they reflect the changes we've made to the resource provider schema\.

   When we first initiated the resource provider project, the CloudFormation CLI generated supporting files and code for our resource provider\. Since we've made changes to the resource provider schema, we'll need to regenerate that code to ensure that it reflects the updated schema\. To do this, we use the generate command:

   ```
   $ cfn generate
   Generated files for Testing::Unicorn::Maker
   ```

## Implement the Resource Handlers<a name="resource-type-walkthrough-implement"></a>

Now that we have our resource provider schema specified, we can start implementing the behavior we want the resource provider to exhibit during each resource operation\. To do this, we'll have to implement the various event handlers, for Typescript all the handlers are in the same file `testing-unicorn-maker/src/handlers.ts`.

## Helpers<a name="resource-type-walkthrough-implement-helpers"></a>

At the top of the file below the existing imports add:

```
import fetch, { Response } from 'node-fetch';

// Use this logger to forward log messages to CloudWatch Logs.
const LOGGER = console;
const CRUD_CRUD_ID = '<CRUD_CRUD_ID>';
const API_ENDPOINT = `https://crudcrud.com/api/${CRUD_CRUD_ID}/unicorns`;
const DEFAULT_HEADERS = {
    'Accept': 'application/json; charset=utf-8',
    'Content-Type': 'application/json; charset=utf-8'
};

const checkedResponse = async (response: Response, uid?: string): Promise<any> => {
    if (response.status === 404) {
        throw new exceptions.NotFound(ResourceModel.TYPE_NAME, uid);
    } else if (![200, 201].includes(response.status)) {
        throw new exceptions.InternalFailure(
            `crudcrud.com error ${response.status} ${response.statusText}`,
            HandlerErrorCode.InternalFailure,
        );
    }
    const data = await response.text() || '{}';
    LOGGER.debug(`HTTP response ${data}`);
    return JSON.parse(data);
}
```

This lines include the setup for the communication with crudcrud and a helper to validate the response from it, specially important is the throwing of the right exceptions (e.g. `NotFound` if the requested unicorn does not exist).

## Implement the Create Handler<a name="resource-type-walkthrough-implement-create"></a>

Replace the contents of the `create` handler with:

```
LOGGER.debug('CREATE request', request);
const model: ResourceModel = request.desiredResourceState;
if (model.uid) throw new exceptions.InvalidRequest("Create unicorn with readOnly property");

const progress = ProgressEvent.progress<ProgressEvent<ResourceModel, CallbackContext>>(model);
const body: Object = { ...model };
LOGGER.debug('CREATE body', body);
const response: Response = await fetch(API_ENDPOINT, {
    method: 'POST',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
});
const jsonData: any = await checkedResponse(response);
progress.resourceModel.uid = jsonData['_id'];
progress.status = OperationStatus.Success;
LOGGER.log('CREATE progress', { ...progress });
return progress;
```

Especially important in the create handler is to not assign read only properties, but instead throw and `InvalidRequest` esception.

## Implement the Update Handler<a name="resource-type-walkthrough-implement-update"></a>

Replace the contents of the `update` handler with:

```
LOGGER.debug('UPDATE request', request);
const model: ResourceModel = request.desiredResourceState;
const progress = ProgressEvent.progress<ProgressEvent<ResourceModel, CallbackContext>>(model);
const body: any = { ...model };
delete body['uid'];
LOGGER.debug('UPDATE body', body);
const response: Response = await fetch(`${API_ENDPOINT}/${model.uid}`, {
    method: 'PUT',
    headers: DEFAULT_HEADERS,
    body: JSON.stringify(body),
});
await checkedResponse(response, model.uid);
progress.status = OperationStatus.Success;
LOGGER.log('UPDATE progress', { ...progress });
return progress;
```

## Implement the Delete Handler<a name="resource-type-walkthrough-implement-delete"></a>

Replace the contents of the `delete` handler with:

```
LOGGER.debug('DELETE request', request);
const model: ResourceModel = request.desiredResourceState;
const progress = ProgressEvent.progress<ProgressEvent<ResourceModel, CallbackContext>>();
const response: Response = await fetch(`${API_ENDPOINT}/${model.uid}`, {
    method: 'DELETE',
    headers: DEFAULT_HEADERS,
});
await checkedResponse(response, model.uid);
progress.status = OperationStatus.Success;
LOGGER.log('DELETE progress', { ...progress });
return progress;
```

## Implement the Read Handler<a name="resource-type-walkthrough-implement-read"></a>

Replace the contents of the `read` handler with:

```
LOGGER.debug('READ request', request);
const model: ResourceModel = request.desiredResourceState;
const response: Response = await fetch(`${API_ENDPOINT}/${model.uid}`, {
    method: 'GET',
    headers: DEFAULT_HEADERS,
});
const jsonData: any = await checkedResponse(response, model.uid);
model.name = jsonData['name'];
model.color = jsonData['color'];
const progress: ProgressEvent<ResourceModel> = ProgressEvent.builder()
    .status(OperationStatus.Success)
    .resourceModel(model)
    .build() as ProgressEvent<ResourceModel>;
LOGGER.log('READ progress', { ...progress });
return progress;
```

## Implement the List Handler<a name="resource-type-walkthrough-implement-list"></a>

Replace the contents of the `list` handler with:

```
LOGGER.debug('LIST request', request);
const response: Response = await fetch(API_ENDPOINT, {
    method: 'GET',
    headers: DEFAULT_HEADERS,
});
const jsonData: any[] = await checkedResponse(response);
const models: Array<ResourceModel> = jsonData.map((unicorn: any) => {
    return new ResourceModel({
        uid: unicorn['_id'],
        name: unicorn['name'],
        color: unicorn['color'],
    });
});
const progress: ProgressEvent<ResourceModel> = ProgressEvent.builder()
    .status(OperationStatus.Success)
    .resourceModels(models)
    .build() as ProgressEvent<ResourceModel>;
LOGGER.log('LIST progress test logger', { ...progress });
return progress;
```

After all the handlers have been implemented run `npm build`.

## Create the SAM Test Files and test the handlers<a name="resource-type-walkthrough-test-files"></a>

1. Create five files:
   + `testing-unicorn-maker/sam-tests/create.json`
   + `testing-unicorn-maker/sam-tests/read.json`
   + `testing-unicorn-maker/sam-tests/update.json`
   + `testing-unicorn-maker/sam-tests/delete.json`
   + `testing-unicorn-maker/sam-tests/list.json`

2. In `testing-unicorn-maker/sam-tests/create.json`, paste the following test\.

    **Note:**
    Add the necessary information, such as credential and remove any comments in the file before testing\.
    To generate temporary credentials, you can run the command `aws sts get-session-token`\. Finally, ensure Docker is running on your computer and make sure you have added the root directory of this walkthroug (or any ancestor directory) to `Docker > Preferences > Resources > FILE SHARING`.

    ```
    {
        "credentials": {
            # Real STS credentials need to go here.
            "accessKeyId": "",
            "secretAccessKey": "",
            "sessionToken": ""
        },
        "action": "CREATE",
        "request": {
            "clientRequestToken": "4b90a7e4-b790-456b-a937-0cfdfa211dfe", # Can be any UUID.
            "desiredResourceState": {
                "name": "Johny",
                "color": "Pink"
            },
            "previousResourceState": null,
            "logicalResourceIdentifier": null
        },
        "callbackContext": null
    }
    ```

    Now you can run `sam local invoke TestEntrypoint --event sam-tests/create.json` and upon success that last line of output should look like:
    ```
    {"message":"","callbackDelaySeconds":0,"status":"SUCCESS","resourceModel":{"uid":"5f88ccccd899cd03e8b4ef15","name":"Johny","color":"Pink"}}
    ```

3. In `testing-unicorn-maker/sam-tests/read.json`, paste the following test\.

    ```
    {
        "credentials": {
            # Real STS credentials need to go here.
            "accessKeyId": "",
            "secretAccessKey": "",
            "sessionToken": ""
        },
        "action": "READ",
        "request": {
            "clientRequestToken": "4b90a7e4-b790-456b-a937-0cfdfa211dfe",  # Can be any UUID.
            "desiredResourceState": {
                "uid": "<unicorn_id>"
            },
            "logicalResourceIdentifier": "MyResource"
        },
        "callbackContext": null
    }
    ```

    Now you can run `sam local invoke TestEntrypoint --event sam-tests/read.json` and upon success that last line of output should look like:
    ```
    {"message":"","callbackDelaySeconds":0,"status":"SUCCESS","resourceModel":{"uid":"5f88ccccd899cd03e8b4ef15","name":"Johny","color":"Pink"}}
    ```


    In order to get the unicorn id visit `https://crudcrud.com/api/<CRUD_CRUD_ID>/unicorns` and copy the `uid` of any of them.

4. In `testing-unicorn-maker/sam-tests/update.json`, paste the following test\.

    ```
    {
        "credentials": {
            # Real STS credentials need to go here.
            "accessKeyId": "",
            "secretAccessKey": "",
            "sessionToken": ""
        },
        "action": "UPDATE",
        "request": {
            "clientRequestToken": "4b90a7e4-b790-456b-a937-0cfdfa211dfe", # Can be any UUID.
            "desiredResourceState": {
                "uid": "5f88ccccd899cd03e8b4ef15",
                "color": "Sky Blue",
                "name": "Jerry"
            },
            "logicalResourceIdentifier": "MyResource"
        },
        "callbackContext": null
    }
    ```

    Now you can run `sam local invoke TestEntrypoint --event sam-tests/update.json` and upon success that last line of output should look like:
    ```
    {"message":"","callbackDelaySeconds":0,"status":"SUCCESS","resourceModel":{"uid":"5f88ccccd899cd03e8b4ef15","name":"Jerry","color":"Sky Blue"}}
    ```

5. In `testing-unicorn-maker/sam-tests/delete.json`, paste the following test\.

    ```
    {
        "credentials": {
            # Real STS credentials need to go here.
            "accessKeyId": "",
            "secretAccessKey": "",
            "sessionToken": ""
        },
        "action": "DELETE",
        "request": {
            "clientRequestToken": "4b90a7e4-b790-456b-a937-0cfdfa211dfe",  # Can be any UUID.
            "desiredResourceState": {
                "uid": "<unicorn_id>"
            },
            "logicalResourceIdentifier": "MyResource"
        },
        "callbackContext": null
    }
    ```

    Now you can run `sam local invoke TestEntrypoint --event sam-tests/delete.json` and upon success that last line of output should look like:
    ```
    {"message":"","callbackDelaySeconds":0,"status":"SUCCESS"}
    ```

6. In `testing-unicorn-maker/sam-tests/list.json`, paste the following test\.

    ```
    {
        "credentials": {
            # Real STS credentials need to go here.
            "accessKeyId": "",
            "secretAccessKey": "",
            "sessionToken": ""
        },
        "action": "LIST",
        "request": {
            "clientRequestToken": "4b90a7e4-b790-456b-a937-0cfdfa211dfe",  # Can be any UUID.
            "desiredResourceState": {},
            "logicalResourceIdentifier": "MyResource"
        },
        "callbackContext": null
    }
    ```

    Now you can run `sam local invoke TestEntrypoint --event sam-tests/list.json` and upon success that last line of output should look like:
    ```
    {"message":"","callbackDelaySeconds":0,"status":"SUCCESS","resourceModels":[]}
    ```

    In this case the `resourceModels` came back empty because we just deleted the only unicorn we had created, if you run the create test a couple times and the the list one again upon success that last line of output should look like:
    ```
    {"message":"","callbackDelaySeconds":0,"status":"SUCCESS","resourceModels":[{"uid":"5f89c5d8d899cd03e8b4ef3b","Name":"Johny","Color":"Pink"},{"uid":"5f89d019d899cd03e8b4ef3c","Name":"Johny","Color":"Pink"}]}
    ```

## Performing Resource Contract Tests<a name="resource-type-walkthrough-test-contract"></a>

Resource contract tests verify that the resource type provider schema you've defined properly catches property values that will fail when passed to the underlying APIs called from within your resource handlers\. This provides a way of validating user input before passing it to the resource handlers\. For example, in the `Testing::Unicorn::Maker` resource type provider schema \(in the `testing-unicorn-maker.json` file\), we specified regex patterns for the `uid`, `name` and `color` properties, and set limits to the length of `name` and `color`\. Contract tests are intended to stress and validate those input definitions\.

#### Run the Resource Contract Tests<a name="resource-type-walkthrough-test-contract-run"></a>

To run resource contract tests, you'll need two shell sessions\.

1. In a new session, run `sam local start-lambda`\.

1. In the current session, run `cfn test`\.

   The session that is running `sam local start-lambda` will display information about the status of your tests\. All the test should be passing.

## Submit the Resource Provider<a name="resource-type-walkthrough-submit"></a>

Once you have finished implementing and testing your resource provider, the final step is to submit it to the CloudFormation registry\. This makes it available for use in stack operations in the account and region in which it was submitted\.
+ In a terminal, run the `submit` command to register the resource provider in the us\-west\-2 region\.

    ```
    cfn submit -v --region us-west-2
    ```

The CloudFormation CLI validates the included resource provider schema, builds your resource provider project and uploads it to the CloudFormation registry, and then returns a registration token\.

```
Validating your resource schema...
Starting build.
Creating testing-unicorn-maker-role-stack
testing-unicorn-maker-role-stack stack was successfully created
Creating CloudFormationManagedUploadInfrastructure
Successfully submitted type. Waiting for registration with token '<token>' to complete.
Registration complete.
{<JSON with deployment details>}
```

At this point you can go to your AWS account and you will see your resource provider under `Cloudformation > Cloudformation Registry > Resource Types > Private`.

**Note:**

If you update your resource provider, you can submit a new version of that resource provider\. Every time you submit your resource provider, CloudFormation generates a new version of that resource provider\.
To set the default version of a resource provider, use [SetTypeDefaultVersion](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_SetTypeDefaultVersion.html)\. For example:

```
aws cloudformation set-type-default-version --type "RESOURCE" --type-name "Testing::Unicorn::Maker" --version-id "00000002"
```
To retrieve information about the versions of a resource provider, use [ListTypeVersions](https://docs.aws.amazon.com/AWSCloudFormation/latest/APIReference/API_ListTypeVersions.html)\. For example:

```
aws cloudformation list-type-versions --type "RESOURCE" --type-name "Testing::Unicorn::Maker"
```
