module.exports.duplicateFileErr = (duplicateFiles) =>
  `The files ${duplicateFiles} are already present in the repository. Please remove them from drafts, rename and try again.`;
module.exports.fileNotFoundErr = (fileNotFound) =>
  `File not found.`;
