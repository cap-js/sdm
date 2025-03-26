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
module.exports.renameFileErr = (duplicateFiles, statusCondition) => {
  const bulletPoints = duplicateFiles.map(file => `• ${file}`).join('\n');
  if (statusCondition === "don't") {
    return `The following files could not be renamed as they ${statusCondition} exist:\n${bulletPoints}\n\nDelete and upload the files again.\n`;
  }
  return `The following files could not be renamed as they ${statusCondition} exist:\n${bulletPoints}\n`;
};
module.exports.renameOtherFilesErr = (otherFiles, otherFileMessages) => {
  const bulletPoints = otherFiles.map((file, index) => `• ${file} : ${otherFileMessages[index]}`).join('\n');
  return `The following files could not be renamed:\n${bulletPoints}\n`;
};
module.exports.otherFileErr = (otherFiles) => {
  const message = otherFiles.map(file => `${file}`).join('\n');
  return `${message}\n`;
};
module.exports.versionedRepositoryErr = 'Attachments are not supported for a versioned repository.';
module.exports.userNotAuthorisedError  = 'You do not have the required permissions to upload attachments. Please contact your administrator for access.';
module.exports.userDoesNotHaveRequiredScope = 'User does not have the required scope';
module.exports.errorMessage = 'An error occurred';
module.exports.nameConstrainErr = (fileNameWithRestrictedCharacters, operation) => {
  const prefixMessage = `${operation} unsuccessful. The following filename(s) contain unsupported characters (/, \\). \n\n`;
  const bulletPoints = fileNameWithRestrictedCharacters.map(file => `\t• ${file}`).join('\n');
  const message = `${prefixMessage}${bulletPoints}\n\nRename the file(s) and try again.\n`;
  return message;
};
