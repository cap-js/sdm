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
  return await SELECT("*")
    .from(attachments.drafts)
    .where(conditions)
}

async function getDraftAttachmentsForUpID(attachments, req, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: req.data[up_],
    repositoryId: repositoryId
  };
  return await SELECT("filename", "mimeType", "content", "url", "ID", "HasActiveEntity")
    .from(attachments)
    .where(conditions)
}

async function getFileNameForAttachmentID(attachmentsEntity, attachmentID) {
  const files = await SELECT.from(attachmentsEntity)
    .columns("filename")
    .where({ ID: attachmentID });

  // Ensure the result is not empty and return the filename
  if (files.length > 0 && files[0].filename) {
    return files[0].filename.toString();
  }

  // Return null if no file is found
  return null;
}

async function getPropertiesForID(attachmentsEntity, id, secondaryTypeProperties) {
  // Build the query
  const propertyKeys = Object.keys(secondaryTypeProperties);
  const result = await SELECT.from(attachmentsEntity)
    .columns(...propertyKeys)
    .where({ ID: id });

  const propertyValueMap = {};

  // Iterate through the properties map and populate propertyValueMap
  for (const [property, mapKey] of secondaryTypeProperties.entries()) {
    const value = result.length > 0 ? result[0][property] : null;
    propertyValueMap[mapKey] = value !== null ? value : null;
  }

  return propertyValueMap;
}

async function getFolderIdForEntity(attachments, req, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: req.data[up_],
    repositoryId: repositoryId
  };
  return await SELECT.from(attachments)
    .columns("folderId")
    .where(conditions);
}

async function updateAttachmentInDraft(req, data) {
  return await UPDATE(req.target)
    .set({ folderId: data.folderId, url: data.url, status: "Clean" })
    .where({ ["ID"]: req.params[1].ID});
}

async function getURLsToDeleteFromAttachments(deletedAttachments, attachments) {
  return await SELECT.from(attachments)
    .columns("url")
    .where({ ID: { in: [...deletedAttachments] } });
}

async function getURLsToDeleteFromDraftAttachments(ID, draftAttachments) {
  const up_ = draftAttachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: ID,
    HasActiveEntity: false
  };
  return await SELECT.from(draftAttachments)
    .columns("url")
    .where(conditions);
}

async function getURLToDeleteFromDraftAttachments(id, draftAttachments) {
  const conditions = {
    ID: id,
    HasActiveEntity: false
  };
  return await SELECT.from(draftAttachments)
    .columns("url")
    .where(conditions);
}

async function setRepositoryId(attachments, repositoryId) {
  if(attachments) {
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
  getDraftAttachmentsForUpID,
  getFileNameForAttachmentID,
  getPropertiesForID,
  getURLsToDeleteFromAttachments,
  getURLsToDeleteFromDraftAttachments,
  getURLToDeleteFromDraftAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
  updateAttachmentInDraft,
  setRepositoryId
};
