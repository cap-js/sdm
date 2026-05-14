# Change Log

All notable changes to this project will be documented in this file.
This project adheres to [Semantic Versioning](http://semver.org/).
The format is based on [Keep a Changelog](http://keepachangelog.com/).


## Version 1.10.0

### Fixed
- Updated cap-js/attachments version to 3.12.1 and fixed the underlying rename issues for attachments.
- Fixed a bug where incorrect warning message is thrown when file was updated/deleted from sdm backend.
- Fixed namespace issue to include Attachments along with sap.attachments.Attachments.

### Added
- Added support for technical user flow.

## Version 1.9.1

### Fixed
- Fixed issue where onboarding a tenant was skipping onboarding for another tenant and Offboarding of repository for one tenant was deleting data for other tenant.

## Version 1.9.0

### Added
- Added support for attachments in non-draft entities.

### Fixed
- Fixed issue where deleting an entity without attachments failed to remove the corresponding folder in SDM.
- Resolved issue where setting custom property values to null did not reset the values in SDM.
- Improved error and warning messages when users without SDM Roles attempt to update custom properties or rename attachments.
- Fixed issue where the edit-link button was not displayed when editing entities with link type attachments.

## Version 1.8.2

### Fixed
- Token handling and SDM API calls to use SAP Cloud SDK.
- Support custom name for Attachments composition.
- Issue where undefined error object in token generation caused application crash.

## Version 1.8.1

### Fixed
- Allow update or creation of subscription in case a repository with the configured external ID already exists by skipping the onboarding step.
- Token handling to support scenario where no attachments are added
- Link doesn't get reverted in SDM when changes are discarded on the UI 
- Error handling for scenario where user doesn't have SDM Roles

## Version 1.8.0

### Added
- Support for Link type Attachments.
- Support to Edit URL in Link type Attachments.

## Version 1.7.0

### Added
- Support for CDS v9.
- Support repository onboarding for multitenant use case.
- Support repository offboarding for multitenant use case.

### Fixed
- Entity ID retrieval to support both OData containment modes for compatibility with CDS v8/9.
- Missing response object in xssec token exchange error callbacks.

## Version 1.6.0

### Added
- Support custom properties in attachments.

### Fixed
- Issue where users were unable to read attachments after uploading them.

## Version 1.5.1

### Fixed
- Issue where attachments are deleted from SDM upon any metadata update in the entity.

## Version 1.5.0

### Added
- Handling of special characters in attachments name during upload and rename of attachments.

### Fixed
- Error to allow any name in the primary key for the entity.
- Issue with deleting attachments from SDM when the entity has not been saved once.
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

Updated the documentation.

## Version 1.0.1

### Fixed

Updated the documentation. 

## Version 1.0.0

### Added

Initial release that provides the following features 

- Create attachment : Provides the capability to upload new attachments.
- Open attachment : Provides the capability to preview attachments.
- Delete attachment : Provides the capability to remove attachments.
- Rename attachment : Provides the capability to rename attachments.
- Virus scanning : Provides the capability to support virus scan for virus scan enabled repositories.
- Draft functionality : Provides the capability of working with draft attachments.
