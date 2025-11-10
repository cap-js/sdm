module.exports.duplicateDraftFileErr = (duplicateDraftFiles) =>
  `The file(s) ${duplicateDraftFiles} have been added multiple times. Please rename and try again.`;

module.exports.skippingOnboarding = (repositoryName, repositoryId) =>
  `Repository with name ${repositoryName} and id ${repositoryId} already exists. Skipping onboarding.`;

module.exports.virusFileErr = (virusFiles) => {
  const bulletPoints = virusFiles.map(file => `• ${file}`).join('\n');
  return `The following files contain potential malware and cannot be uploaded:\n${bulletPoints}\n`;
};
module.exports.duplicateFileErr = (duplicateFiles) => {
  const bulletPoints = duplicateFiles.map(file => `• ${file}`).join('\n');
  return `The following files could not be uploaded as they already exist:\n${bulletPoints}\n`;
};
module.exports.renameFileErr = (duplicateFiles, statusCondition) => {
  const bulletPoints = duplicateFiles.map(file => `• ${file}`).join('\n');
  if (statusCondition === "don't") {
    return `The following files could not be updated as they ${statusCondition} exist:\n${bulletPoints}\n\nDelete and upload the files again.\n`;
  }
  return `The following files could not be updated as they ${statusCondition} exist:\n${bulletPoints}\n`;
};
module.exports.renameOtherFilesErr = (otherFiles, otherFileMessages) => {
  const bulletPoints = otherFiles.map((file, index) => `• ${file} : ${otherFileMessages[index]}`).join('\n');
  return `The following files could not be updated:\n${bulletPoints}\n`;
};

module.exports.otherFileErr = (otherFiles) => {
  const message = otherFiles.map(file => `${file}`).join('\n');
  return `${message}\n`;
};
module.exports.attachmentIDRegex =/\/\w+\(.*ID=([0-9a-fA-F-]{36})/
module.exports.emptyFileNameErr = 'The file name cannot be empty or consist entirely of space characters. Enter a value.\n';
module.exports.versionedRepositoryErr = 'Attachments are not supported for a versioned repository.';
module.exports.userNotAuthorisedError  = 'You do not have the required permissions to upload attachments. Please contact your administrator for access.';
module.exports.userNotAuthorisedErrorLink  = 'You do not have the required permissions to upload links. Please contact your administrator for access.';
module.exports.userNotAuthorisedErrorEditLink  = 'You do not have the required permissions to edit links. Please contact your administrator for access.';
module.exports.sdmMissingRolesExceptionMsg = 'You do not have the required permissions to update attachments. Please contact your administrator for access.';
module.exports.editLinkNotFoundErr = 'The link you are trying to edit does not exist or invalid.';
module.exports.userDoesNotHaveRequiredScope = 'User does not have required scope';
module.exports.userDoesNotHaveScopeToDelete = 'You do not have the required permissions to delete attachments. Please contact your administrator for access.';
module.exports.errorMessage = 'An error occurred';
module.exports.userNotAuthorisedOpenLink  = 'You do not have the required permissions to open links. Please contact your administrator for access.';
module.exports.userNotAuthorisedReadError  = 'You do not have the required permissions to read attachments. Please contact your administrator for access.';
module.exports.attachmentNotFound  = 'Attachment not found.';

module.exports.nameConstrainErr = (fileNameWithRestrictedCharacters, operation) => {
  const prefixMessage = `${operation} unsuccessful. The following filename(s) contain unsupported characters (/, \\). \n\n`;
  const bulletPoints = fileNameWithRestrictedCharacters.map(file => `\t• ${file}`).join('\n');
  const message = `${prefixMessage}${bulletPoints}\n\nRename the file(s) and try again.\n`;
  return message;
};
module.exports.linkNameConstraintMessage = (fileNameWithRestrictedCharacters, operation) => {
  const prefixMessage = `Link could not be ${operation}. The following name(s) contain unsupported characters (/, \\). \n\n`;
  const bulletPoints = fileNameWithRestrictedCharacters.map(file => `\t• ${file}`).join('\n');
  const message = `${prefixMessage}${bulletPoints}\n\nRename the file(s) and try again.\n`;
  return message;
};
module.exports.sdmAnnotationAdditionalpropertyName = "@SDM.Attachments.AdditionalProperty.name";
module.exports.sdmAnnotationAdditionalproperty = "@SDM.Attachments.AdditionalProperty";
module.exports.updateAttachmentError = "Could not update the attachment";
module.exports.sdmRolesErrorMessage = "Unable to rename the file due to an error at the server";
module.exports.unsupportedProperties = "Unsupported properties";
module.exports.repositoryUrl = 'rest/v2/repositories';
module.exports.repositoryMissing = 'Repository ID is missing in configurations.';
module.exports.repositoryConfigurationMissing = 'Repository Configuration is missing in config.js file.';
module.exports.noSDMRolesErrorMessage = (files, operation) => {
  // Create the base message
  const prefixMessage = `Could not ${operation} the following files. \n\n`;
  // Initialize the message with the formatted prefix
  let bulletPoints = prefixMessage;
  // Append each file name and its error message
  files.forEach((item) => {
    bulletPoints += `\t• ${item}\n`;
  });
  bulletPoints += '\n';
  if (operation === 'create') {
    bulletPoints += this.userNotAuthorisedError;
  } else {
    bulletPoints += this.sdmMissingRolesExceptionMsg;
  }
  return bulletPoints;
}
module.exports.unsupportedPropertiesErrorMessage = (propertiesList) => {
 // Create the base message
 const prefixMessage = "The following secondary properties are not supported:\n\n";

 // Initialize the message with the prefix
 let bulletPoints = prefixMessage;

 // Append each unsupported property to the message
 propertiesList.forEach((property) => {
   bulletPoints += `\t• ${property}\n`;
 });

 // Append the closing message
 bulletPoints += "\nPlease contact your administrator for assistance with any necessary adjustments.";

 return bulletPoints;
}
module.exports.badRequestErrorMessage = (badRequest) => {

  // Create the base message
  const prefixMessage = "Could not update the following files:\n\n";

  // Initialize the message with the prefix
  let bulletPoints = prefixMessage;

  // Append each file name and its error message to the message
  badRequest.forEach((request) => {
    bulletPoints += `\t• ${request.name} : ${request.message}\n`;
  });

  // Append the closing message
  bulletPoints += "\nPlease try again.";

  return bulletPoints;
}