# AWS CloudFormation Resource Provider Typescript Plugin

We're excited to share our progress with adding new languages to the CloudFormation CLI!

## AWS CloudFormation Resource Provider TypeScript Plugin

[![GitHub Workflow Status](https://img.shields.io/github/workflow/status/eduardomourar/cloudformation-cli-typescript-plugin/ci/master)](https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/actions?query=branch%3Amaster+workflow%3Aci) [![Codecov](https://img.shields.io/codecov/c/gh/eduardomourar/cloudformation-cli-typescript-plugin)](https://codecov.io/gh/eduardomourar/cloudformation-cli-typescript-plugin) [![GitHub release](https://img.shields.io/github/v/release/eduardomourar/cloudformation-cli-typescript-plugin?include_prereleases)](https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/releases) [![Node.js version](https://img.shields.io/badge/dynamic/json?color=brightgreen&url=https://raw.githubusercontent.com/eduardomourar/cloudformation-cli-typescript-plugin/master/package.json&query=$.engines.node&label=nodejs)](https://nodejs.org/)

The CloudFormation CLI (cfn) allows you to author your own resource providers that can be used by CloudFormation.

This plugin library helps to provide TypeScript runtime bindings for the execution of your providers by CloudFormation.

Usage
-----

If you are using this package to build resource providers for CloudFormation, install the [CloudFormation CLI TypeScript Plugin](https://github.com/eduardomourar/cloudformation-cli-typescript-plugin) - this will automatically install the [CloudFormation CLI](https://github.com/aws-cloudformation/cloudformation-cli)! A Python virtual environment is recommended.

**Prerequisites**

- Python version 3.6 or above
- [SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-install.html)
- Your choice of TypeScript IDE

**Installation**


```shell
pip3 install cloudformation-cli-typescript-plugin
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
$ sam local invoke --event sam-tests/create.json TestEntrypoint
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

For changes to the typescript library "@amazon-web-services-cloudformation/cloudformation-cli-typescript-lib" pack up the compiled javascript:

```shell
npm run build
npm pack
```

You can then install this in a cfn resource project using:

```shell
npm install ../path/to/cloudformation-cli-typescript-plugin/amazon-web-services-cloudformation-cloudformation-cli-typescript-lib-1.0.1.tgz
```

Linting and running unit tests is done via [pre-commit](https://pre-commit.com/), and so is performed automatically on commit after being installed (`pre-commit install`). The continuous integration also runs these checks. Manual options are available so you don't have to commit:

```shell
# run all hooks on all files, mirrors what the CI runs
pre-commit run --all-files
# run unit tests only. can also be used for other hooks, e.g. black, flake8, pylint-local
pre-commit run pytest-local
```

License
-------

This library is licensed under the Apache 2.0 License.
