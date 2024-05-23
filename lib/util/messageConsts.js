module.exports.duplicateDraftFileErr = (duplicateDraftFiles) =>
  `The files ${duplicateDraftFiles} are added multiple times. Please remove them from drafts, rename and try again.`;
module.exports.emptyFileErr = (fileName) =>
  `Content of file ${fileName} is empty. Either it is corrupted or not uploaded properly.`;
