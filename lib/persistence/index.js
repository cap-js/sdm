const cds = require("@sap/cds/lib");
const { SELECT, UPDATE } = cds.ql;

async function getURLFromAttachments(keys, attachments) {
  return await SELECT.from(attachments, keys).columns("url");
}

async function getDraftAttachments(attachments, req, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  const conditions = {
    [up_]: req.data[idValue],
    repositoryId: repositoryId
  };
  return await SELECT("filename", "mimeType", "content", "url", "ID", "HasActiveEntity")
    .from(attachments.drafts)
    .where(conditions)
}

async function getFolderIdForEntity(attachments, req, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  const conditions = {
    [up_]: req.data[idValue],
    repositoryId: repositoryId
  };
  return await SELECT.from(attachments)
    .columns("folderId")
    .where(conditions);
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
  if(attachments){
    let nullAttachments = await SELECT()
    .from(attachments)
    .where({ repositoryId: null });

  if (!nullAttachments || nullAttachments.length === 0) {
    return; 
  }

  for (let attachment of nullAttachments) {
    await UPDATE(attachments)
      .set({ repositoryId: repositoryId })
      .where({ ID: attachment.ID });
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
