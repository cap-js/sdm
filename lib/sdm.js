const cds = require("@sap/cds/lib");
const NodeCache = require("node-cache");
const cache = new NodeCache();
const {
  getRepositoryInfo,
  getFolderIdByPath,
  getFolderIdByIDAsPath,
  createFolder,
  createAttachment,
  editLink,
  deleteAttachmentsOfFolder,
  deleteFolderWithAttachments,
  getAttachment,
  readAttachment,
  updateAttachment
} = require("./handler/index");
const {
  fetchAccessToken,
  isRepositoryVersioned,
  getConfigurations,
  getClientCredentialsToken,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties
} = require("./util/index");
const {
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
  editLinkInDraft
} = require("../lib/persistence");
const {
  duplicateDraftFileErr,
  renameFileErr,
  virusFileErr,
  duplicateFileErr,
  versionedRepositoryErr,
  otherFileErr,
  userDoesNotHaveRequiredScope,
  userNotAuthorisedError,
  renameOtherFilesErr,
  nameConstrainErr,
  linkNameConstraintMessage,
  sdmRolesErrorMessage,
  unsupportedProperties,
  noSDMRolesErrorMessage,
  unsupportedPropertiesErrorMessage,
  badRequestErrorMessage,
  emptyFileNameErr,
  userNotAuthorisedErrorLink,
  userNotAuthorisedErrorEditLink,
  attachmentIDRegex,
  editLinkNotFoundErr,
  userNotAuthorisedOpenLink,
  userNotAuthorisedReadError,
  attachmentNotFound,
  errorMessage
} = require("./util/messageConsts");

module.exports = class SDMAttachmentsService extends (
  require("@cap-js/attachments/lib/basic")
) {
  init() {
    this.creds = this.options.credentials;
    // Temporary storage for original URLs during draft editing
    this.originalUrlMap = new Map();
    return super.init();
  }
  getSDMCredentials() {
    return this.creds;
  }

  async checkRepositoryType(req) {
    const { repositoryId } = getConfigurations();
    let subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
    //check if repository is versionable
    let repotype = cache.get(repositoryId+"_"+subdomain);
    let isVersioned;
    if (repotype == undefined) {
      const token = await getClientCredentialsToken(this.creds);
      const repoInfo = await getRepositoryInfo(req, this.creds, token);
      isVersioned = isRepositoryVersioned(repoInfo, repositoryId);
    } else {
      isVersioned = repotype == "versioned";
    }
    if (isVersioned) {
      req.reject(400, versionedRepositoryErr);
    }
  }

  async get(attachments, keys, req) {
    const response = await getURLFromAttachments(keys, attachments);
    const token = await fetchAccessToken(
      this.creds,
      req.user.tokenInfo.getTokenValue()
    );
    const Key = response?.url;
    const content = await readAttachment(Key, token, this.creds);
     if(content && typeof content === 'object' && content.status && content.status == 200){
      return content.data;
      }
    else{
       if(content == "Forbidden"){
          req.reject(403, userNotAuthorisedReadError);
       }
       else if(content =="Not Found"){
          req.reject(404, attachmentNotFound);
       }
          else
          req.reject(500, errorMessage);
    }
  }


  getAttachmentCompositions(targetEntity) {
    const attachmentCompositions = [];
    const entityDef = cds.model.definitions[targetEntity.name];
    
    if (!entityDef || !entityDef.elements) {
      return attachmentCompositions;
    }

    for (const [elementName, element] of Object.entries(entityDef.elements)) {
      if (element.type === 'cds.Composition' && element.target) {
        const targetDef = cds.model.definitions[element.target];
        if (targetDef && targetDef.includes && targetDef.includes.includes('sap.attachments.Attachments')) {
          attachmentCompositions.push(elementName);
        }
      }
    }
    
    return attachmentCompositions;
  }

  async renameHandler(req) {
    const { repositoryId } = getConfigurations();
    const attachmentCompositions = this.getAttachmentCompositions(req.target);
    
    for (const composition of attachmentCompositions) {
      await this.processCompositionRename(req, composition, repositoryId);
    }
  }

  async processCompositionRename(req, compositionName, repositoryId) {
    const attachmentsEntity = cds.model.definitions[req.target.name + "." + compositionName];
    if (!attachmentsEntity) {
      return;
    }
    
    const attachment_val = await getDraftAttachments(attachmentsEntity, req, repositoryId);

    if (attachment_val.length > 0) {
      const token = await fetchAccessToken(
        this.creds,
        req.user.tokenInfo.getTokenValue()
      );
      await this.isFileNameDuplicateInDrafts(attachment_val, req);

      const propertyTitles = getPropertyTitles(attachmentsEntity, attachment_val[0]);
      const secondaryPropertiesWithInvalidDefinitions =
              getSecondaryPropertiesWithInvalidDefinition(
                attachmentsEntity, attachment_val[0]);

      const secondaryTypeProperties = getSecondaryTypeProperties(attachmentsEntity, attachment_val[0]);

      let attachment_val_rename = [];
      let draft_attachments = [];
      draft_attachments = attachment_val.filter(attachment => attachment.HasActiveEntity === false);
      attachment_val_rename = attachment_val.filter(attachment => attachment.HasActiveEntity === true);

      let allErrors = [];

      // Updating draft attachments
      for (const attachment of draft_attachments) {
        const errorResponse = await this.updateDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName);
        allErrors = allErrors.concat(errorResponse);
      }

      // Updating non-draft attachments
      for (const attachment of attachment_val_rename) {
        const errorResponse = await this.updateNonDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName);
        allErrors = allErrors.concat(errorResponse);
      }

      this.clearSecondaryPropertiesCache(repositoryId);

      const errorMessage = this.handleWarning(allErrors, propertyTitles);
      if(errorMessage.length != 0){
        req.warn(500, errorMessage);
      }
    }
  }

  async updateDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName) {
    const attachmentData = await this.getAttachementDataInSDM(this.creds.uri, token, attachment.url);
    const filenameInSDM = attachmentData.filename;
    
    const context = {
      attachment,
      attachmentsEntity,
      filenameInSDM,
      compositionName,
      secondaryProperties: {
        invalidDefinitions: secondaryPropertiesWithInvalidDefinitions,
        typeProperties: secondaryTypeProperties
      }
    };
    
    return this._updateAttachments(req, token, context);
  }

  async updateNonDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName) {
    const fileNameInDB = await getFileNameForAttachmentID(attachmentsEntity, attachment.ID);
    
    const context = {
      attachment,
      attachmentsEntity,
      filenameInSDM: fileNameInDB,
      compositionName,
      secondaryProperties: {
        invalidDefinitions: secondaryPropertiesWithInvalidDefinitions,
        typeProperties: secondaryTypeProperties
      }
    };
    
    return this._updateAttachments(req, token, context);
  }

  async _updateAttachments(req, token, context) {
    const { attachment, attachmentsEntity, filenameInSDM, compositionName, secondaryProperties } = context;
    const { invalidDefinitions, typeProperties } = secondaryProperties;
    
    let failedReq = [];
    const propertiesInDB = await getPropertiesForID(attachmentsEntity, attachment.ID, typeProperties);
    const updatedSecondaryProperties = getUpdatedSecondaryProperties(attachment, typeProperties, propertiesInDB);
    const filenameInRequest = attachment.filename;

    const validationError = this.validateFilename(filenameInRequest);
    if (validationError) {
      failedReq.push(validationError);
      this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, typeProperties, compositionName);
      return failedReq;
    }

    if (filenameInSDM !== filenameInRequest) {
      updatedSecondaryProperties["cmis:name"] = filenameInRequest;
    }

    if (Object.keys(updatedSecondaryProperties).length > 0) {
      const updateResult = await this.performAttachmentUpdate(
        req, token, attachment, updatedSecondaryProperties, invalidDefinitions, filenameInRequest
      );
      
      if (updateResult.error) {
        failedReq.push(updateResult.error);
        this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, typeProperties, compositionName);
      }
    }

    return failedReq;
  }

  validateFilename(filename) {
    if (isRestrictedCharactersInName(filename)) {
      return { typeOfError: 'restricted characters', name: filename };
    }
    if (filename == null || filename.trim().length === 0) {
      return { typeOfError: 'empty name', name: filename };
    }
    return null;
  }

  async performAttachmentUpdate(req, token, attachment, updatedSecondaryProperties, invalidDefinitions, filenameInRequest) {
    try {
      const responseCode = await updateAttachment(req, attachment, this.creds, token, updatedSecondaryProperties, invalidDefinitions);

      switch (responseCode) {
        case 403:
          return { error: { typeOfError: 'no sdm roles', name: filenameInRequest } };
        case 409:
          return { error: { typeOfError: 'duplicate', name: filenameInRequest } };
        case 404:
          return { error: { typeOfError: 'not found', name: filenameInRequest } };
        case 200:
        case 201:
          return { success: true };
        default:
          throw new Error(sdmRolesErrorMessage);
      }
    } catch (e) {
      if (e.message.startsWith(unsupportedProperties)) {
        const unsupportedDetails = e.message.substring(unsupportedProperties.length).trim();
        return { error: { typeOfError: 'unsupported properties', details: unsupportedDetails } };
      }
      return { error: { typeOfError: 'bad request', name: filenameInRequest, message: e.message } };
    }
  }

  replacePropertiesInAttachment(req, id, fileName, propertiesInDB, secondaryTypeProperties, compositionName) {
    if (!req.data[compositionName]) {
      return;
    }
    
    const attachment = req.data[compositionName].find(element => element.ID === id);
    if (!attachment) {
      return;
    }

    if (propertiesInDB) {
      for (const [dbKey, dbValue] of Object.entries(propertiesInDB)) {
        const secondaryKey = [...secondaryTypeProperties.entries()]
          .find(([, value]) => value === dbKey)?.[0];

        if (secondaryKey) {
          attachment[secondaryKey] = dbValue;
        }
      }
    }

    // Replace the file name in the attachment
    attachment.filename = fileName;
  }

  clearSecondaryPropertiesCache(repositoryId) {
    const cacheKey = `validSecondaryProperties_${repositoryId}`;

    // Check if the cache exists and remove the key
    if (cache.has(cacheKey)) {
      cache.del(cacheKey); // Emptying cache after attachments are updated in loop
    }
  }

  handleWarning(allErrors, propertyTitles) {
    const restrictedCharacters = allErrors.filter(error =>
      error.typeOfError === 'restricted characters'
    );

    const duplicate = allErrors.filter(error =>
      error.typeOfError === 'duplicate'
    );
    const duplicateNames = duplicate.map(attachment => attachment.name);

    const notFound = allErrors.filter(error =>
      error.typeOfError === 'not found'
    );
    const notFoundNames = notFound.map(attachment => attachment.name);

    const noSDMRoles = allErrors.filter(error =>
      error.typeOfError === 'no sdm roles'
    );
    const noSDMRolesNames = noSDMRoles.map(attachment => attachment.name);

    const unsupportedProperties = allErrors.filter(error =>
      error.typeOfError === 'unsupported properties'
    );
    const unsupportedPropertiesDetails = unsupportedProperties.map(attachment => attachment.details);

    const badRequest = allErrors.filter(error =>
      error.typeOfError === 'bad request'
    );

    const emptyFileNames = allErrors.filter(error =>
      error.typeOfError === 'empty name'
    );

    const otherErrors = allErrors.filter(error =>
      error.typeOfError !== 'duplicate'
      && error.typeOfError !== 'not found'
      && error.typeOfError !== 'restricted characters'
      && error.typeOfError !== 'no sdm roles'
      && error.typeOfError !== 'unsupported properties'
      && error.typeOfError !== 'bad request'
      && error.typeOfError !== 'empty name'
    );
    const otherNames = otherErrors.map(attachment => attachment.name);
    const otherMessages = otherErrors.map(attachment => attachment.typeOfError);


    let errorResponse = "";
    if (restrictedCharacters.length > 0) {
      errorResponse += nameConstrainErr(restrictedCharacters.map(attachment => attachment.name), "Update");
    }
    if (duplicateNames.length > 0) {
      errorResponse += renameFileErr(duplicateNames, getStatusCondition(409));
    }
    if (notFoundNames.length > 0) {
      errorResponse += renameFileErr(notFoundNames, getStatusCondition(404));
    }
    if (noSDMRolesNames.length > 0) {
      errorResponse += noSDMRolesErrorMessage(noSDMRolesNames, "update");
    }
    if (unsupportedPropertiesDetails.length > 0) {
      const invalidPropertyNames = [];
      const uniqueValues = new Set();

      // Extract unique values from filesWithUnsupportedProperties
      unsupportedPropertiesDetails.forEach((str) => {
        const values = str.split(",");
        values.forEach((value) => {
          uniqueValues.add(value.trim());
        });
      });

      // Convert the Set to an array and map property titles
      const propertiesList = Array.from(uniqueValues);
      propertiesList.forEach((file) => {
        invalidPropertyNames.push(propertyTitles[file]);
      });

      // Warn if invalid property names exist
      if (invalidPropertyNames.length > 0) {
        errorResponse += unsupportedPropertiesErrorMessage(invalidPropertyNames);
      }
    }
    if (badRequest.length > 0) {
      errorResponse += badRequestErrorMessage(badRequest);
    }
    if (emptyFileNames.length > 0) {
      errorResponse += emptyFileNameErr;
    }
    if (otherNames.length > 0) {
      errorResponse += renameOtherFilesErr(otherNames, otherMessages);
    }
    return errorResponse;
  }

  async getAttachementDataInSDM(uri, token, objectId) {
    const response = await getAttachment(uri, token, objectId);
    const responseData = { filename: response?.data?.succinctProperties["cmis:name"], folderId: response?.data?.succinctProperties["sap:parentIds"][0] };
    return responseData;
  }

  async draftSaveHandler(req) {

    if (req?.data?.content) {
      const { repositoryId } = getConfigurations();
      await this.checkRepositoryType(req);
      const draftAttachments = req.target;
      const attachment_val = await getDraftAttachmentsForUpID(draftAttachments, req, repositoryId);

      if (attachment_val.length > 0) {
        const attachmentID = req.req.url.match(attachmentIDRegex)[1];
        const attachmentToUpload = attachment_val.find(attachment => attachment.ID === attachmentID);
        const filename = attachmentToUpload ? attachmentToUpload.filename : null;
        if (filename) {
          const nameConstraint = isRestrictedCharactersInName(filename);
          if (nameConstraint) {
            req.reject(409, nameConstrainErr([filename], "Upload"));
          }
        }
        await this.isFileNameDuplicateInDrafts(attachment_val, req);
        const token = await fetchAccessToken(
          this.creds,
          req.user.tokenInfo.getTokenValue()
        );
        let attachment_val_create = [];
        if (req.data.content) {
          attachment_val_create = attachment_val.filter(attachment => attachment.HasActiveEntity === false && attachment.ID === attachmentID);
        }
        if(attachment_val_create.length>0){
          attachment_val_create[0].content = req.data.content;
          await this.create(attachment_val_create, draftAttachments, req, token)
        }
      }
      req.data.content = null;
    }
  }

  async create(attachment_val_create, attachments, req, token){
    let parentId = await this.getParentId(attachments, req, token)
    await this.onCreate(
      attachment_val_create,
      this.creds,
      token,
      req,
      parentId
    );
  }

  async getParentId(attachments, req, token, upId){
    const { repositoryId } = getConfigurations();
    const folderIds = await getFolderIdForEntity(attachments, req, repositoryId, upId);
    let parentId = null;
    for (const folder of folderIds) {
      if (folder.folderId !== null) {
        parentId = folder.folderId;
        break;
      }
    }
    if (!parentId) {
      const folderId = await getFolderIdByPath(
        req,
        this.creds,
        token,
        attachments,
        upId
      );
      if (folderId) {
        parentId = folderId;
      } else {
        const response = await createFolder(
          req,
          this.creds,
          token,
          attachments,
          upId
        );
        if (response.status == 403 && response.response.data == userDoesNotHaveRequiredScope) {
          req.reject(403, userNotAuthorisedError);
        }
        parentId = response.data.succinctProperties["cmis:objectId"];
      }
    }
    return parentId;
  }

  async isFileNameDuplicateInDrafts(data, req) {
    let fileNames = [];
    for (let index in data) {
      fileNames.push(data[index].filename);
    }
    const duplicates = this.filterDuplicates(fileNames);
    if (duplicates.length != 0) {
      req.reject(409, duplicateDraftFileErr(duplicates.join(", ")));
    }
  }

  async validateLinkName(data, linkNameInRequest, req) {
    const nameConstraint = isRestrictedCharactersInName(linkNameInRequest);
    if (nameConstraint) {
      req.reject(409, linkNameConstraintMessage([linkNameInRequest], "created"));
    }

    let fileNames = [];
    for (let index in data) {
      fileNames.push(data[index].filename);
    }
    fileNames.push(linkNameInRequest);
    const duplicates = this.filterDuplicates(fileNames);
    if (duplicates.length != 0) {
      req.reject(409, duplicateDraftFileErr(duplicates.join(", ")));
    }
  }

  filterDuplicates(fileNames) {
    return [
      ...new Set(
        fileNames.filter((value, index, self) => {
          return self.indexOf(value) !== index;
        })
      ),
    ];
  }

  async filterAttachments(req) {
    const { repositoryId } = getConfigurations();
    if (!req.query.SELECT.where) {
      req.query.SELECT.where = [];
    }

    if (req.query.SELECT.where.length > 0) {
      req.query.SELECT.where.push('and');
    }

    req.query.SELECT.where.push(
      { ref: ['repositoryId'] },
      '=',
      { val: repositoryId }
    );
  }

  async setRepository(req) {
    const attachments =
      cds.model.definitions[req.target.name];
    const { repositoryId } = getConfigurations(); // Fetch repositoryId from configurations
    await setRepositoryId(attachments, repositoryId)
  }

  async attachDeletionData(req) {
    const attachmentCompositions = this.getAttachmentCompositions(req.target);
    
    for (const compositionName of attachmentCompositions) {
      const attachments = cds.model.definitions[req.target.name + "." + compositionName];
      if (attachments) {
        const diffData = await req.diff();
        await this.processAttachmentDeletion(req, diffData, compositionName, attachments);
      }
    }
  }

  async processAttachmentDeletion(req, diffData, compositionName, attachments) {
    if (!diffData?.[compositionName]?.length) {
      return;
    }

    const deletedAttachments = this.extractDeletedAttachmentIds(diffData[compositionName]);
    
    if (deletedAttachments.length > 0) {
      await this.addAttachmentsToDeleteList(req, deletedAttachments, attachments);
    }
    
    if (req.event === "DELETE") {
      await this.addFolderToParentIdList(req, attachments);
    }
  }

  extractDeletedAttachmentIds(compositionData) {
    return compositionData
      .filter((object) => object._op === "delete")
      .map((attachment) => attachment.ID);
  }

  async addAttachmentsToDeleteList(req, deletedAttachments, attachments) {
    const attachmentsToDelete = await getURLsToDeleteFromAttachments(
      deletedAttachments,
      attachments
    );
    
    if (attachmentsToDelete.length > 0) {
      if (!req.attachmentsToDelete) {
        req.attachmentsToDelete = [];
      }
      req.attachmentsToDelete.push(...attachmentsToDelete);
    }
  }

  async addFolderToParentIdList(req, attachments) {
    const token = await fetchAccessToken(
      this.creds,
      req.user.tokenInfo.getTokenValue()
    );
    const folderId = await getFolderIdByIDAsPath(
      req,
      this.creds,
      token,
      attachments
    );
    
    if (folderId) {
      if (!req.parentId) {
        req.parentId = [];
      }
      req.parentId.push(folderId);
    }
  }

  async attachDraftDeletionData(req) {
    const baseEntityName = req.target.name.replace(/\.drafts$/, "");
    const baseEntity = cds.model.definitions[baseEntityName];
    if (!baseEntity) {
      return;
    }
    
    const attachmentCompositions = this.getAttachmentCompositions({ name: baseEntityName });
    
    for (const compositionName of attachmentCompositions) {
      let draftAttachments = cds.model.definitions[baseEntityName + "." + compositionName + ".drafts"];
      if(draftAttachments)  {
        const attachmentsToDeleteFromDraft = await getURLsToDeleteFromDraftAttachments(req.data.ID, draftAttachments);
        if (attachmentsToDeleteFromDraft?.length > 0) {
          if (!req.attachmentsToDelete) {
            req.attachmentsToDelete = [];
          }
          req.attachmentsToDelete.push(...attachmentsToDeleteFromDraft);
        }
        const diffData = await req.diff();
        if (req.event == "DELETE" && diffData[compositionName]?.length == attachmentsToDeleteFromDraft?.length) {
          const token = await fetchAccessToken(
            this.creds,
            req.user.tokenInfo.getTokenValue()
          );
          const folderId = await getFolderIdByIDAsPath(
            req,
            this.creds,
            token,
            draftAttachments
          );
          if (folderId) {
            if (!req.parentId) {
              req.parentId = [];
            }
            req.parentId.push(folderId);
          }
        }
      }
    }
  }

  async attachURLsToDeleteFromAttachmentsDraft(req) {
    let draftAttachments = cds.model.definitions[req.target.name];
    if(draftAttachments)  {
      const attachmentsToDeleteFromDraft = await getURLToDeleteFromDraftAttachments(req.data.ID, draftAttachments);
      if (attachmentsToDeleteFromDraft?.length > 0) {
        req.attachmentsToDelete = attachmentsToDeleteFromDraft;
      }
      if (req?.attachmentsToDelete?.length > 0) {
      await this.deleteAttachmentsWithKeys(req.attachmentsToDelete, req);
      }
    }
  }

  async deleteAttachmentsWithKeys(records, req) {
    let failedReq = [],
      Ids = [];
    if (req?.attachmentsToDelete?.length > 0) {
    const token = await fetchAccessToken(
          this.creds,
          req.user.tokenInfo.getTokenValue()
        );
       if (req?.parentId) {
        // Handle both single parentId and array of parentIds
        const parentIds = Array.isArray(req.parentId) ? req.parentId : [req.parentId];
        for (const parentId of parentIds) {
          await deleteFolderWithAttachments(this.creds, token, parentId);
        }
      } else {
        const deletePromises = req.attachmentsToDelete.map(
          async (attachment) => {
            const deleteAttachmentResponse = await deleteAttachmentsOfFolder(
              this.creds,
              token,
              attachment.url
            );
            const delData = await this.handleRequest(
              deleteAttachmentResponse,
              attachment.url
            );
            if (delData && Object.keys(delData).length > 0) {
              failedReq.push(delData.message);
              Ids.push(delData.ID);
            }
          }
        );
        // Execute all promises
        await Promise.all(deletePromises);
        let removeCondition = (obj) => Ids.includes(obj.ID);
        req.attachmentsToDelete = req.attachmentsToDelete.filter(
          (obj) => !removeCondition(obj)
        );
        let errorResponse = "";
        failedReq.forEach((attachment) => {
          errorResponse = errorResponse + "\n" + attachment;
        });
        if (errorResponse != "") req.info(200, errorResponse);
      }
    } else {
      if (req?.parentId) {
       const token = await fetchAccessToken(
                this.creds,
                req.user.tokenInfo.getTokenValue()
              );
        // Handle both single parentId and array of parentIds
        const parentIds = Array.isArray(req.parentId) ? req.parentId : [req.parentId];
        for (const parentId of parentIds) {
          await deleteFolderWithAttachments(this.creds, token, parentId);
        }
      }
    }
  }

  async onCreate(data, credentials, token, req, parentId) {
    let fileNames = [];
    const { repositoryId } = getConfigurations();
    await Promise.all(
      data.map(async (d) => {
        const response = await createAttachment(
          d,
          credentials,
          token,
          parentId
        );
        if (response.status == 201) {
          d.folderId = parentId;
          d.url = response.data?.succinctProperties["cmis:objectId"];
          d.repositoryId = repositoryId;
          d.content = null;
          d.type = 'sap-icon://document';
          await updateAttachmentInDraft(req, d);
        } else {
          console.log("Response  "+response.response.data.message);
          fileNames.push(d.filename);
if(response.response.data.message == 'Malware Service Exception: Virus found in the file!'){
            req.reject(403, virusFileErr(fileNames));
          }
          else if(response.response.data.exception == "nameConstraintViolation"){
            req.reject(409, duplicateFileErr(fileNames));
          }
          else if(response.status == 403){
             req.reject(403, userNotAuthorisedError);
          }
          else{
            req.reject(otherFileErr(fileNames));
          }
        }
      })
    );
  }

  async openAttachment(req) {
    let attachments =
      cds.model.definitions[req.target.name];
    let attachmentId = { ID: req.req.url.match(attachmentIDRegex)[1] }
    let response = await getMetadataForOpenAttachment(attachmentId, attachments);
    let objectId = response?.url;
    if (response?.filename == null) {
      attachments = cds.model.definitions[req.target.name.replace(/\.drafts$/, "")];
      response = await getMetadataForOpenAttachment(attachmentId, attachments);
    }
    if (response?.mimeType.toLowerCase() == "application/internet-shortcut") {
      //Fetch token see if roles are present
      const token = await fetchAccessToken(
          this.creds,
          req.user.tokenInfo.getTokenValue()
        );
         const authresponse = await getAttachment(this.creds.uri, token, objectId);
      if(authresponse == "Forbidden" || (authresponse && typeof authresponse === 'object' && authresponse.status === 403)){
    req.reject(403,userNotAuthorisedOpenLink);
      }
      return { value: response.linkUrl };
    } else {
      return { value: "None" };
    }
  }

  async handleCreateLinkAction(req) {
    const { repositoryId } = getConfigurations();
    let key = req.req.url.match(attachmentIDRegex)[1];
    const linkNameInRequest = req.data.name;

    console.info(`[createLink] action called`, {
      repositoryId,
      entity: req.target?.name,
      key,
      linkName: linkNameInRequest,
      user: req.user?.id
    });

    await this.checkRepositoryType(req);

    const attachment = cds.model.definitions[req.target.name];
    const draftAttachments = await getDraftAttachmentsMetadataForLinkCreation(key, attachment, repositoryId);

    await this.validateLinkName(draftAttachments, linkNameInRequest, req);

    const linkToCreateInSDM = {
      filename: linkNameInRequest,
      mimeType: "application/internet-shortcut",
      repositoryId: repositoryId,
      linkUrl: req.data.url
    };

    const token = await fetchAccessToken(
      this.creds,
      req.user.tokenInfo.getTokenValue()
    );
    await this.processLinkCreation(linkToCreateInSDM, attachment, req, token);

  }

  async processLinkCreation(linkToCreateInSDM, attachment, req, token) {
    const upIdKey = attachment.keys.up_.keys[0].$generatedFieldName;
    const upId = req.req.url.match(attachmentIDRegex)[1];

    console.info(`[processLinkCreation] called`, {
      upIdKey,
      upId,
      linkToCreateInSDM
    });

    let parentId = await this.getParentId(attachment, req, token, upId);

    console.info(`[processLinkCreation] parentId resolved`, {
      parentId
    });

    await this.createLink(
      linkToCreateInSDM,
      this.creds,
      token,
      req,
      parentId,
      upIdKey
    );

    console.info(`[processLinkCreation] createLink completed`, {
      parentId,
      upIdKey,
      upId
    });
  }

  async createLink(linkToCreateInSDM, credentials, token, req, parentId, upIdKey) {
    const { repositoryId } = getConfigurations();
    const upId = req.req.url.match(attachmentIDRegex)[1];

    console.info(`[createLink] called`, {
      linkToCreateInSDM,
      parentId,
      upIdKey,
      upId
    });

    // Process single link object
    const response = await createAttachment(
      linkToCreateInSDM,
      credentials,
      token,
      parentId
    );

    console.info(`[createLink] createAttachment response`, {
      status: response.status
    });

    if (response.status == 201) {
      const draftUUID = await getDraftAdministrativeData_DraftUUIDForUpId(req, upIdKey, upId);

      console.info(`[createLink] draftUUID fetched`, {
        draftUUID: draftUUID[0]?.DraftAdministrativeData_DraftUUID
      });

      // Update the link in draft
      const updatedFields = {
        url: response.data?.succinctProperties['cmis:objectId'],
        repositoryId: repositoryId,
        folderId: parentId,
        status: "Clean",
        type: "sap-icon://internet-browser",
        [upIdKey]: upId,
        mimeType: response.data?.succinctProperties['cmis:contentStreamMimeType'],
        filename: req.data?.name,
        HasDraftEntity: false,
        HasActiveEntity: false,
        linkUrl: req.data?.url,
        DraftAdministrativeData_DraftUUID: draftUUID[0].DraftAdministrativeData_DraftUUID,
      };
      console.info(`[createLink] updating link in draft`, { updatedFields });

      await updateLinkInDraft(req, updatedFields);
    } else {
      const fileName = req.data?.name;
      if (response.response.data.exception == "nameConstraintViolation") {
        console.warn(`[createLink] nameConstraintViolation`, { fileName, response: response.response.data });
        req.reject(409, duplicateFileErr([fileName]));
      } else if (response.status == 403) {
        console.warn(`[createLink] user not authorised`, { user: req.user?.id, response: response.response.data });
        req.reject(403, userNotAuthorisedErrorLink);
      }
      else {
        console.error(`[createLink] other error`, { message: response?.response?.data?.message, response: response.response.data });
        req.reject(response?.response?.data?.message);
      }
    }
  }

  async handleEditLinkAction(req) {
    const attachmentId = req.req.url.match(attachmentIDRegex)[1];
    const attachmentsEntity = cds.model.definitions[req.target.name];
    const existingAttachment = await getAttachmentById(attachmentId, attachmentsEntity);

    if (!existingAttachment || !existingAttachment.url) {
      req.reject(404, editLinkNotFoundErr);
      return;
    }

    const newLinkUrl = req.data.url;
    const token = await fetchAccessToken(
    this.creds,
    req.user.tokenInfo.getTokenValue()
    );
    const filenameToUpdate = existingAttachment.filename.replace(/\.url$/, '');
    const objectIdToUpdate = existingAttachment.url;

    const response = await editLink(objectIdToUpdate, filenameToUpdate, newLinkUrl, this.creds, token);
    const status = response?.status || response?.code;

    if (status === 200 || status === 201) {
      let baselineUrl = existingAttachment.linkUrl;
      const attachmentKey = `${attachmentId}`;
      if (this.originalUrlMap.has(attachmentKey)) {
        baselineUrl = this.originalUrlMap.get(attachmentKey);
      } else {
        this.originalUrlMap.set(attachmentKey, baselineUrl);
      }

      const updatedFields = {
        ID: attachmentId,
        linkUrl: newLinkUrl,
        note: `__BASELINE_URL__:${baselineUrl}`
      };
      await editLinkInDraft(req, updatedFields);
      return {
        success: true,
        message: "Link edited successfully"
      };
    } else if (status === 403) {
      console.warn(`[editLink] user not authorised`, { user: req.user?.id, response: response?.response?.data });
      req.reject(400, userNotAuthorisedErrorEditLink);
    } else {
      console.error(`[editLink] other error`, { message: response?.response?.data?.message, response: response.response.data });
      req.reject(response?.response?.data?.message);
    }
}
  async handleDraftSaveForLinks() {
    // Find all entities with attachment compositions
    const allEntities = Object.keys(cds.model.definitions);
    const entityPatterns = [];
    
    for (const entityName of allEntities) {
      const entity = cds.model.definitions[entityName];
      if (entity && entity.elements) {
        const attachmentCompositions = this.getAttachmentCompositions({ name: entityName });
        for (const composition of attachmentCompositions) {
          entityPatterns.push(`${entityName}.${composition}`);
          entityPatterns.push(`${entityName}.${composition}.drafts`);
        }
      }
    }
    
    for (const entityName of entityPatterns) {
      const attachmentsEntity = cds.model.definitions[entityName];
      if (attachmentsEntity) {
        await this.updateBaselinesForEntity(entityName);
      }
    }
  }

  async updateBaselinesForEntity(attachmentsEntityName) {
    for (const [attachmentKey] of this.originalUrlMap.entries()) {
        const attachment = await global.SELECT.one.from(attachmentsEntityName)
          .where({ 
            ID: attachmentKey,
            mimeType: "application/internet-shortcut",
            note: { like: "__BASELINE_URL__:%" }
          });
          
        if (attachment) {
          this.originalUrlMap.set(attachmentKey, attachment.linkUrl);
          await global.UPDATE(attachmentsEntityName)
            .set({ note: null })
            .where({ ID: attachmentKey });
        }
    }
  }

  async handleDraftDiscardForLinks(req) {
    let parentId = req.data.ID;
    const baseEntityName = req.target.name.replace(/\.drafts$/, "");
    const baseEntity = cds.model.definitions[baseEntityName];
    if (!baseEntity) {
      return;
    }
    
    const attachmentCompositions = this.getAttachmentCompositions({ name: baseEntityName });
    
    const token = await fetchAccessToken(
      this.creds,
      req.user.authInfo?.token?.getTokenValue() || req.user.tokenInfo.getTokenValue()
    );

    for (const compositionName of attachmentCompositions) {
      const attachmentsEntityName = `${baseEntityName}.${compositionName}.drafts`;
      const attachmentsEntity = cds.model.definitions[attachmentsEntityName];
      if (!attachmentsEntity) {
        continue;
      }
      
      const upKey = attachmentsEntity.keys?.up_?.keys?.[0]?.$generatedFieldName || 'up__ID';
      const draftAttachments = await global.SELECT.from(attachmentsEntityName)
        .where({ 
          [upKey]: parentId,
          mimeType: "application/internet-shortcut",
          note: { like: "__BASELINE_URL__:%" }
        });

      for (const attachment of draftAttachments) {
        if (attachment.note?.startsWith("__BASELINE_URL__:")) {
          const baselineUrl = attachment.note.substring("__BASELINE_URL__:".length);
          
          if (baselineUrl && attachment.linkUrl !== baselineUrl) {
            await this.revertLinkInSDM(attachment, baselineUrl, token);
            const attachmentKey = `${attachment.ID}`;
            this.originalUrlMap.delete(attachmentKey);
          }
        }
      }
    }
  }

  async revertLinkInSDM(draftAttachment, originalLinkUrl, token) {
    try {
      const filenameToUpdate = draftAttachment.filename.replace(/\.url$/, '');
      const objectIdToUpdate = draftAttachment.url;
      
      await editLink(
        objectIdToUpdate,
        filenameToUpdate,
        originalLinkUrl,
        this.creds,
        token
      );
    } catch (error) {
      console.error(`[revertLinkInSDM] error reverting link for attachment ${draftAttachment.ID}:`, error.message);
      throw error;
    }
  }

  async handleRequest(response, objectId) {
    let responseData = {},
      status = "";
    if (response.status != undefined) {
      status = response.status;
    } else status = response.response.status;
    switch (status) {
      case 404:
      case 200:
        break;
      default:
        responseData["ID"] = objectId;
        responseData["message"] = response.message;
        return responseData;
    }
  }

  async getStatus() {
    return "Clean";
  }



  registerUpdateHandlers(srv, entity, target) {
    srv.before(
      ["DELETE","UPDATE"],
      entity,
      this.attachDeletionData.bind(this)
    );
    srv.before(
      ["DELETE"],
      entity.drafts,
      this.attachDraftDeletionData.bind(this)
    );
    srv.before(["DELETE"], [ target.drafts], this.attachURLsToDeleteFromAttachmentsDraft.bind(this));
    srv.before("DELETE", entity.drafts, this.handleDraftDiscardForLinks.bind(this));
    srv.after("SAVE", entity, this.handleDraftSaveForLinks.bind(this));    
    srv.before("READ", [target, target.drafts], this.setRepository.bind(this))
    srv.before("READ", [target, target.drafts], this.filterAttachments.bind(this))
    srv.before("SAVE", entity, this.renameHandler.bind(this));
    if (target.drafts) {
      srv.before(
        "PUT",
        target.drafts,
        this.draftSaveHandler.bind(this)
      );
    }
    srv.after(
      ["DELETE","UPDATE"],
      [entity, entity.drafts],
      this.deleteAttachmentsWithKeys.bind(this)
    );
    // Handler for custom action 'openAttachment'
    srv.on('openAttachment', async (req) => {
      return this.openAttachment(req);
    });
    // Handler for custom action 'createLink'
    srv.on('createLink', async (req) => {
      return this.handleCreateLinkAction(req);
    });
    // Handler for custom action 'editLink'
    srv.on('editLink', async (req) => {
      return this.handleEditLinkAction(req);
    });
  }
};
