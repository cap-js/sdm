# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).

## Version 1.5.0

### Added
- Handling of special characters in attachments name during upload and rename of attachments.

### Fixed
- Issue related to entity creation failure when application is deployed with a versioned repository.
- Error message in case of rename when attachment is deleted from backend SDM repository.

## Version 1.4.0

### Added 

- Attachment stored in SDM as soon as user uploads the attachment.
- Capability to configure repository id from user provided variables.

### Changed
- Attachments usage changed to using { sap.attachments.Attachments } from '@cap-js/attachments'.

## Version 1.3.0

### Added
Display attachments specific to repository: Lists attachments contained in the repository that is configured with the CAP application.

### Fixed
- Issue with repositoryId caching in multitenant scenario.
- Error message on read of attachment when attachment is deleted from DI.

## Version 1.2.2

### Fixed

 - App crash issue on update of fields when no attachments are added.
 - Attachment getting renamed even when duplicate attachment of same name exists.

## Version 1.2.1

### Added
Updated @sap/cds version to 8.

## Version 1.2.0

### Added
Added Multitenancy support. Multiple subscribers are now allowed to subscribe to a SaaS CAP application using this plugin.

## Version 1.1.0

### Added
Added additional validation to check if repository is versioned and show UI message that versioned repository is not supported.

## Version 1.0.2

### Fixed

Updated the documentation

## Version 1.0.1

### Fixed

Updated the documentation 

## Version 1.0.0

### Added

Initial release that provides the following features 

- Create attachment : Provides the capability to upload new attachments.
- Open attachment : Provides the capability to preview attachments.
- Delete attachment : Provides the capability to remove attachments.
- Rename attachment : Provides the capability to rename attachments.
- Virus scanning : Provides the capability to support virus scan for virus scan enabled repositories.
- Draft functionality : Provides the capability of working with draft attachments.
