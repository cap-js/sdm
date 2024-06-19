module.exports.duplicateDraftFileErr = (duplicateDraftFiles) =>
  `The file(s) ${duplicateDraftFiles} have been added multiple times. Please rename and try again.`;
module.exports.emptyFileErr = (fileName) =>
  `Content of file ${fileName} is empty. Either it is corrupted or not uploaded properly.`;
