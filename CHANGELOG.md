# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.3.3] - 2020-09-23
### Changed
- [CLI Plugin] Update CloudFormation CLI dependency package
- [Support Library] Make certain request fields optional to unblock contract testing (#25)
- [Support Library] Update optional dependency to newer AWS SDK Javascript used in Lambda runtime


## [0.3.2] - 2020-08-31
### Added
- [CLI Plugin] Wildcard .gitignore pattern in case rpdk.log rotates
- [Support Library] New properties for resource request: `desiredResourceTags`, `previousResourceTags`, `systemTags`, `awsAccountId`, `region` and `awsPartition` (#23)

### Removed
- [Support Library] Account ID from metric namespace


## [0.3.1] - 2020-08-19
### Fixed
- [Support Library] Cast from empty string to number or boolean (#22)


## [0.3.0] - 2020-08-09
### Added
- [CLI Plugin] Primary and additional identifiers can be retrieved using the appropriate methods in base model class
- [Support Library] Recast properties from string to intended primitive type based on model (#9)
- [Support Library] New wrapper class for integer types (simplification from bigint)

### Changed
- [CLI Plugin] Improve model serialization/deserialization to handle complex schemas
- [Support Library] While leveraging `class-transformer` library, the properties can now be cast into proper types

### Removed
- [Support Library] Global definitions and auxiliary code extending ES6 Map


## [0.2.1] - 2020-07-14
### Fixed
- [Support Library] Callback context not being properly formatted (#15)


## [0.2.0] - 2020-07-08
### Added
- [Support Library] Support protocol version 2.0.0 to response the handler result with callback directly and allow CloudFormation service to orchestrate the callback (#12)


## [0.1.2] - 2020-05-25
### Fixed
- [Support Library] Error messages not appearing in CloudWatch (#10)


## [0.1.1] - 2020-05-02
### Fixed
- [Support Library] Event handler binding issue


## [0.1.0] - 2020-04-24
### Added
- [Support Library] Schedule CloudWatch Events for re-invocation during long process
- [Support Library] Publish metrics to CloudWatch

### Changed
- [Support Library] Fallback to S3 in log delivery

### Fixed
- [Support Library] CloudWatch log delivery issue


## [0.0.1] - 2020-04-14
### Added
- [CLI Plugin] Initial version in line with [Python plugin](https://github.com/aws-cloudformation/cloudformation-cli-python-plugin)
- [CLI Plugin] Build using SAM CLI (both locally or with docker support)
- [Support Library] Callback in order to report progress to CloudFormation
- [Support Library] Mechanism for log delivery to CloudWatch
- [Support Library] Base Model class as well as Progress Event class


[Unreleased]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.3.3...HEAD
[0.3.3]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.2.1...v0.3.0
[0.2.1]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/releases/tag/v0.0.1
