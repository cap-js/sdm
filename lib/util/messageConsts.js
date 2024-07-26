module.exports.duplicateDraftFileErr = (duplicateDraftFiles) =>
  `The file(s) ${duplicateDraftFiles} have been added multiple times. Please rename and try again.`;
module.exports.emptyFileErr = (fileName) =>
  `Content of file ${fileName} is empty. Either it is corrupted or not uploaded properly.`;
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
