module.exports.duplicateFileErr = (duplicateFiles) =>
  `The files ${duplicateFiles} are already present in the repository. Please remove them from drafts, rename and try again.`;
module.exports.duplicateDraftFileErr = (duplicateDraftFiles) =>
  `The files ${duplicateDraftFiles} are added multiple times. Please remove them from drafts, rename and try again.`;
