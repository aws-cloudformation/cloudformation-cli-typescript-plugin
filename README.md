# DEVELOPER PREVIEW (COMMUNITY DRIVEN)

We're excited to share our progress with adding new languages to the CloudFormation CLI!
> This plugin is an early preview prepared by the community, and not ready for production use.

## AWS CloudFormation Resource Provider TypeScript Plugin

The CloudFormation CLI (cfn) allows you to author your own resource providers that can be used by CloudFormation.

This plugin library helps to provide TypeScript runtime bindings for the execution of your providers by CloudFormation.

Usage
-----

If you are using this package to build resource providers for CloudFormation, install the [CloudFormation CLI TypeScript Plugin](https://github.com/eduardomourar/cloudformation-cli-typescript-plugin) - this will automatically install the the [CloudFormation CLI](https://github.com/aws-cloudformation/cloudformation-cli)! A Python virtual environment is recommended.

**Prerequisites**

 - Python version 3.6 or above
 - [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
 - Your choice of TypeScript IDE

**Installation**

Because this is a developer preview, you still need to install the plugin from GitHub using [pip](https://pypi.org/project/pip/).

```shell
pip3 install git+https://github.com/eduardomourar/cloudformation-cli-typescript-plugin.git#egg=cloudformation-cli-typescript-plugin
```

Refer to the [CloudFormation CLI User Guide](https://docs.aws.amazon.com/cloudformation-cli/latest/userguide/resource-types.html) for the [CloudFormation CLI](https://github.com/aws-cloudformation/cloudformation-cli) for usage instructions.

**Howto**

Example run:

```
$ cfn init
Initializing new project
What's the name of your resource type?
(Organization::Service::Resource)
>> Foo::Bar::Baz
Select a language for code generation:
[1] java
[2] typescript
(enter an integer):
>> 2
Use docker for platform-independent packaging (Y/n)?
This is highly recommended unless you are experienced
with cross-platform Typescript packaging.
>> y
Initialized a new project in <>
$ cfn submit --dry-run
$ cat test.json
{
  "credentials": {
    "accessKeyId": "",
    "secretAccessKey": "",
    "sessionToken": ""
  },
  "action": "CREATE",
  "request": {
    "clientRequestToken": "ecba020e-b2e6-4742-a7d0-8a06ae7c4b2b",
    "desiredResourceState": {
      "Title": "foo",
      "Description": "bar"
    },
    "previousResourceState": null,
    "logicalResourceIdentifier": null
  },
  "callbackContext": null
}
$ sam local invoke TestEntrypoint --event test.json
```

Development
-----------

For changes to the plugin, a Python virtual environment is recommended. Check out and install the plugin in editable mode:

```shell
python3 -m venv env
source env/bin/activate
pip3 install -e /path/to/cloudformation-cli-typescript-plugin
```

You may also want to check out the [CloudFormation CLI](https://github.com/aws-cloudformation/cloudformation-cli) if you wish to make edits to that. In this case, installing them in one operation works well:

```shell
pip3 install \
  -e /path/to/cloudformation-cli \
  -e /path/to/cloudformation-cli-typescript-plugin
```

That ensures neither is accidentally installed from PyPI.

Linting and running unit tests is done via [pre-commit](https://pre-commit.com/), and so is performed automatically on commit after being installed (`pre-commit install`).

```shell
# run all hooks on all files, mirrors what the CI runs
pre-commit run --all-files
# run unit tests only. can also be used for other hooks, e.g. black, flake8, pylint-local
pre-commit run pytest-local
```

License
-------

This library is licensed under the MIT License.
