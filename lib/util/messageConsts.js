module.exports.duplicateDraftFileErr = (duplicateDraftFiles) =>
  `The file(s) ${duplicateDraftFiles} have been added multiple times. Please rename and try again.`;
module.exports.virusFileErr = (virusFiles) => {
  const bulletPoints = virusFiles.map(file => `• ${file}`).join('\n');
  return `The following files contain potential malware and cannot be uploaded:\n${bulletPoints}\n`;
};
module.exports.duplicateFileErr = (duplicateFiles) => {
  const bulletPoints = duplicateFiles.map(file => `• ${file}`).join('\n');
  return `The following files could not be uploaded as they already exist:\n${bulletPoints}\n`;
};
module.exports.renameFileErr = (duplicateFiles) => {
  const bulletPoints = duplicateFiles.map(file => `• ${file}`).join('\n');
  return `The following files could not be renamed as they already exist:\n${bulletPoints}\n`;
};
module.exports.otherFileErr = (otherFiles) => {
  const message = otherFiles.map(file => `${file}`).join('\n');
  return `${message}\n`;
};
module.exports.versionedRepositoryErr = 'Attachments are not supported for a versioned repository.';
module.exports.userNotAuthorisedError  = 'You do not have the required permissions to upload attachments. Please contact your administrator for access.';
module.exports.userDoesNotHaveRequiredScope = 'User does not have the required scope';
module.exports.errorMessage = 'An error occurred';
