const cds = require("@sap/cds/lib");
const { SELECT } = cds.ql;

async function getURLFromAttachments(keys, attachments) {
  return await SELECT.from(attachments, keys).columns("url");
}

async function getDraftAttachments(attachments, req) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  return await SELECT("filename", "mimeType", "content", "url", "ID")
    .from(attachments.drafts)
    .where({ [up_]: req.data[idValue] })
    .and({ HasActiveEntity: { "<>": 1 } });
}

async function getFolderIdForEntity(attachments, req) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  return await SELECT.from(attachments)
    .columns("folderId")
    .where({ [up_]: req.data[idValue] });
}

async function getURLsToDeleteFromAttachments(deletedAttachments, attachments) {
  return await SELECT.from(attachments)
    .columns("url")
    .where({ ID: { in: [...deletedAttachments] } });
}
module.exports = {
  getDraftAttachments,
  getURLsToDeleteFromAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
};
