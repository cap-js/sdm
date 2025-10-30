const cds = require("@sap/cds/lib");
const {
  attachmentIDRegex
} = require("../util/messageConsts");
const { SELECT, UPDATE, INSERT } = cds.ql;

async function getURLFromAttachments(keys, attachments) {
  return await SELECT.from(attachments, keys).columns("url");
}

async function getMetadataForOpenAttachment(keys, attachments) {
  return await SELECT.from(attachments, keys).columns("filename", "mimeType", "linkUrl");
}

async function getDraftAttachmentsMetadataForLinkCreation(keys, attachments, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: keys,
    repositoryId: repositoryId
  };
  return await SELECT("filename", "folderId", "repositoryId").from(attachments).where(conditions);
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

async function getAttachmentById(id, attachmentsEntity) {
  return await SELECT.one.from(attachmentsEntity.drafts).where({ID: id});
}

async function getFolderIdForEntity(attachments, req, repositoryId, upId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const entityId = req.data[up_] || upId;
  const conditions = {
    [up_]: entityId,
    repositoryId: repositoryId
  };
  return await SELECT.from(attachments)
    .columns("folderId")
    .where(conditions);
}

async function updateAttachmentInDraft(req, data) {
  const attachmentID = req.req.url.match(attachmentIDRegex)[1];
  return await UPDATE(req.target)
    .set({ folderId: data.folderId, url: data.url, status: "Clean", type: data.type })
    .where({ ["ID"]: attachmentID });
}

async function updateLinkInDraft(req, data) {
  try {
    // Use cds.db to execute the query instead of req.run
    await INSERT.into(req.target.name).entries(data);
  } catch (err) {
    // Forward the error if req has error method
    if (req.error) {
      req.error(500, `Failed to create draft entry: ${err.message}`);
    } else {
      throw err; // Re-throw if req doesn't have error method
    }
  }
}

async function editLinkInDraft(req, data) {
  try {
    await UPDATE(req.target).set({
        linkUrl: data.linkUrl
    }).where({ ID: data.ID });
  } catch (err) {
    if (req.error) {
      req.error(500, `Failed to update the link: ${err.message}`);
    } else {
      throw err;
    }
  }
}


async function getActiveAttachments(attachments, entityId, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: entityId,
    repositoryId: repositoryId,
    HasActiveEntity: true
  };
  return await SELECT("*")
    .from(attachments)
    .where(conditions);
}

async function getActiveAttachmentsMetadata(attachments, entityId, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: entityId,
    repositoryId: repositoryId,
    HasActiveEntity: true
  };
  return await SELECT("ID", "filename", "mimeType", "url", "linkUrl", "folderId", "type")
    .from(attachments)
    .where(conditions);
}

async function createActiveAttachment(attachments, data) {
  const attachmentData = {
    ...data,
    HasActiveEntity: true,
    status: "Active"
  };
  return await INSERT.into(attachments).entries(attachmentData);
}

async function updateActiveAttachment(attachments, attachmentId, updateData) {
  return await UPDATE(attachments)
    .set(updateData)
    .where({ 
      ID: attachmentId,
      HasActiveEntity: true 
    });
}

async function deleteActiveAttachment(attachments, attachmentId) {
  return await cds.db.run(
    cds.ql.DELETE.from(attachments).where({ 
      ID: attachmentId,
      HasActiveEntity: true 
    })
  );
}

async function getActiveAttachmentById(id, attachmentsEntity) {
  return await SELECT.one.from(attachmentsEntity).where({
    ID: id,
    HasActiveEntity: true
  });
}

async function getActiveAttachmentsByType(attachments, entityId, repositoryId, type) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: entityId,
    repositoryId: repositoryId,
    HasActiveEntity: true,
    type: type
  };
  return await SELECT("*")
    .from(attachments)
    .where(conditions);
}

async function getActiveLinksForEntity(attachments, entityId, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: entityId,
    repositoryId: repositoryId,
    HasActiveEntity: true,
    linkUrl: { '!=': null }
  };
  return await SELECT("ID", "filename", "linkUrl", "mimeType")
    .from(attachments)
    .where(conditions);
}

async function getActiveFilesForEntity(attachments, entityId, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const conditions = {
    [up_]: entityId,
    repositoryId: repositoryId,
    HasActiveEntity: true,
    url: { '!=': null }
  };
  return await SELECT("ID", "filename", "url", "mimeType", "folderId")
    .from(attachments)
    .where(conditions);
}

async function moveAttachmentToActive(draftAttachments, activeAttachments, attachmentId) {
  const draftAttachment = await SELECT.one.from(draftAttachments).where({ ID: attachmentId });
  
  if (!draftAttachment) {
    throw new Error(`Draft attachment with ID ${attachmentId} not found`);
  }

  const activeData = {
    ...draftAttachment,
    HasActiveEntity: true,
    status: "Active"
  };
  delete activeData.DraftAdministrativeData_DraftUUID;

  await INSERT.into(activeAttachments).entries(activeData);
  
  await cds.db.run(
    cds.ql.DELETE.from(draftAttachments).where({ ID: attachmentId })
  );

  return activeData;
}

async function getAttachmentStatistics(attachments, entityId, repositoryId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const baseConditions = {
    [up_]: entityId,
    repositoryId: repositoryId
  };

  const [activeCount, draftCount, linkCount, fileCount] = await Promise.all([
    SELECT.from(attachments).where({ ...baseConditions, HasActiveEntity: true }),
    SELECT.from(attachments).where({ ...baseConditions, HasActiveEntity: false }),
    SELECT.from(attachments).where({ ...baseConditions, HasActiveEntity: true, linkUrl: { '!=': null } }),
    SELECT.from(attachments).where({ ...baseConditions, HasActiveEntity: true, url: { '!=': null } })
  ]);

  return {
    totalActive: activeCount.length,
    totalDraft: draftCount.length,
    totalLinks: linkCount.length,
    totalFiles: fileCount.length
  };
}

async function bulkDeleteActiveAttachments(attachments, attachmentIds) {
  return await cds.db.run(
    cds.ql.DELETE.from(attachments).where({ 
      ID: { in: attachmentIds },
      HasActiveEntity: true 
    })
  );
}

async function getDraftAdministrativeData_DraftUUIDForUpId(req, upIdKey, upId) {
  const entity = req.subject.ref[0].id;
  const idValue = upIdKey.split('__')[1];
  return await SELECT.from(entity)
    .columns("DraftAdministrativeData_DraftUUID")
    .where({ [idValue]: upId});
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
  getMetadataForOpenAttachment,
  getDraftAttachmentsMetadataForLinkCreation,
  getFolderIdForEntity,
  updateAttachmentInDraft,
  updateLinkInDraft,
  setRepositoryId,
  getDraftAdministrativeData_DraftUUIDForUpId,
  getAttachmentById,
  editLinkInDraft,

  // New non-draft exports
  getActiveAttachments,
  getActiveAttachmentsMetadata,
  createActiveAttachment,
  updateActiveAttachment,
  deleteActiveAttachment,
  getActiveAttachmentById,
  getActiveAttachmentsByType,
  getActiveLinksForEntity,
  getActiveFilesForEntity,
  moveAttachmentToActive,
  getAttachmentStatistics,
  bulkDeleteActiveAttachments
};
