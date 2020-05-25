# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.2] - 2020-05-25
### Fixed
- [Support Library] Fix error messages not appearing in CloudWatch


## [0.1.1] - 2020-05-02
### Fixed
- [Support Library] Fix event handler binding


## [0.1.0] - 2020-04-24
### Added
- [Support Library] Schedule CloudWatch Events for re-invocation during long process
- [Support Library] Publish metrics to CloudWatch

### Changed
- [Support Library] Fallback to S3 in log delivery

### Fixed
- [Support Library] Fix CloudWatch log delivery


## [0.0.1] - 2020-04-14
### Added
- [CLI Plugin] Initial version in line with [Python plugin](https://github.com/aws-cloudformation/cloudformation-cli-python-plugin)
- [CLI Plugin] Build using SAM CLI (both locally or with docker support)
- [Support Library] Callback in order to report progress to CloudFormation
- [Support Library] Mechanism for log delivery to CloudWatch
- [Support Library] Base Model class as well as Progress Event class


[Unreleased]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/compare/v0.0.1...v0.1.0
[0.0.1]: https://github.com/eduardomourar/cloudformation-cli-typescript-plugin/releases/tag/v0.0.1
