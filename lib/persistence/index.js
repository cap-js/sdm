const cds = require("@sap/cds/lib");
const { SELECT, UPDATE } = cds.ql;
const { readAttachment } = require("../handler/index");

async function getURLFromAttachments(keys, attachments) {
  return await SELECT.from(attachments, keys).columns("url");
}

async function getDraftAttachments(attachments, req) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  return await SELECT("filename", "mimeType", "content", "url", "ID", "HasActiveEntity")
    .from(attachments.drafts)
    .where({ [up_]: req.data[idValue] })
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

async function getExistingAttachments(attachmentIDs, attachments) {
  return await SELECT("filename", "url", "ID","folderId")
    .from(attachments)
    .where({ ID: { in: [...attachmentIDs] }});
}

async function setRepositoryId(attachments, repositoryId) {
  let nullAttachments = await SELECT()
    .from(attachments)
    .where({ repositoryId: null });

  for (let attachment of nullAttachments) {
    let attachmentData = await readAttachment(attachment);
    if (attachmentData !== null) {
      await UPDATE(attachments)
        .set({ repositoryId: repositoryId })
        .where({ id: attachment.id });
    }
  }
}

module.exports = {
  getDraftAttachments,
  getURLsToDeleteFromAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
  getExistingAttachments,
  setRepositoryId
};
