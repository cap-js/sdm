const cds = require("@sap/cds/lib");
const { SELECT } = cds.ql;

async function getDraftAttachments(queryFields, attachments, req) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  return await SELECT(queryFields)
    .from(attachments.drafts)
    .where({ up_: req.data[idValue] })
    .and({ HasActiveEntity: { "<>": 1 } });
}

async function getDuplicateAttachments(fileNames, attachments) {
  return await SELECT.distinct(["filename"])
    .from(attachments)
    .where({ filename: { in: fileNames } });
}

async function getURLFromAttachments(keys, attachments) {
  return await SELECT.from(attachments, keys).columns("url");
}

async function getURLsToDeleteFromAttachments(deletedAttachments, attachments) {
  return await SELECT.from(attachments)
    .columns("url")
    .where({ ID: { in: [...deletedAttachments] } });
}
module.exports = {
  getDraftAttachments,
  getDuplicateAttachments,
  getURLFromAttachments,
  getURLsToDeleteFromAttachments,
};
