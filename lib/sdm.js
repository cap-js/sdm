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
  updateAttachment,
} = require("./handler/index");
const {
  isRepositoryVersioned,
  getConfigurations,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties,
  getSdmInstanceName,
  transformSDMServiceBindingToJWTBearerCredentialsDestination,
  transformSDMServiceBindingToClientCredentialsDestination
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
  editLinkInDraft,
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
  errorMessage,
  mimeTypeInvalidError,
  largFileVirusScanErr
} = require("./util/messageConsts");
const { getDestinationFromServiceBinding,retrieveJwt} = require('@sap-cloud-sdk/connectivity');

const FILE_SIZE_THRESHOLD = 400 * 1024 * 1024; // 400 MB — files above this use the chunked upload path

module.exports = class SDMAttachmentsService extends (
  require("@cap-js/attachments/srv/attachments/basic")
) {
  async init() {
    this.creds = this.options.credentials;
    this.originalUrlMap = new Map();
    return super.init();
  }
async getTechnicalDestination(){
let subdomain = cds.context?.user?.authInfo?.token?.payload?.ext_attr?.zdn;
 const technicalUserDestn = await getDestinationFromServiceBinding({
      destinationName: getSdmInstanceName(),
      useCache: true,
      serviceBindingTransformFn: (serviceBinding, options) => transformSDMServiceBindingToClientCredentialsDestination(serviceBinding, options,subdomain)
    });
    return technicalUserDestn;
}
  async getDestination(req) {
    // Cache destination on request object to avoid multiple calls
    if (req._sdmDestination) {
      return req._sdmDestination;
    }

    const userJwt =  retrieveJwt(req);
    let destination;
    if (!cds.context?.user?.authInfo?.token?.payload?.origin) {
      let subdomain = cds.context?.user?.authInfo?.token?.payload?.ext_attr?.zdn;
      destination = await getDestinationFromServiceBinding({
        destinationName: getSdmInstanceName(),
        useCache: true,
        serviceBindingTransformFn: (serviceBinding, options) => transformSDMServiceBindingToClientCredentialsDestination(serviceBinding, options, subdomain)});
    } else {
      destination = await getDestinationFromServiceBinding({
        destinationName: getSdmInstanceName(),
        jwt: userJwt,
        useCache: true,
        serviceBindingTransformFn: (serviceBinding, options) => transformSDMServiceBindingToJWTBearerCredentialsDestination(serviceBinding, options, userJwt)});
    }


    // Cache for subsequent calls in the same request
    req._sdmDestination = destination;
    return destination;
  }
  getSDMCredentials() {
    return this.creds;
  }

  async checkRepositoryType(req, contentLengthNum) {
    const { repositoryId } = getConfigurations();
    let subdomain = cds.context?.user?.authInfo?.token?.getPayload()?.ext_attr?.zdn || "default-subdomain";
    let repotype = cache.get(repositoryId+"_"+subdomain);
    let isVersioned;
    let repoInfo;
    if (repotype == undefined) {
      const destination = await this.getTechnicalDestination();
      repoInfo = await getRepositoryInfo(req, this.creds, destination);
      isVersioned = isRepositoryVersioned(repoInfo, repositoryId);
    } else {
      isVersioned = repotype == "versioned";
    }
    if (isVersioned) {
      req.reject(400, versionedRepositoryErr);
    }
  }

  async get(attachments, keys) {
    const response = await getURLFromAttachments(keys, attachments);

    const Key = response?.url;
    // Access current request from cds.context for cloud-sdk authentication
    const req = cds.context?.http?.req;
    if (!req) {
      throw new Error('HTTP request context not available');
    }
    const destination = await this.getDestination(req);
    const content = await readAttachment(Key, destination, this.creds);
     if(content && typeof content === 'object' && content.status && content.status == 200){
      return content.data;
      }
    else{
       if(content == "Forbidden"){
          throw Object.assign(new Error(userNotAuthorisedReadError), { status: 403 });
       }
       else if(content =="Not Found"){
          throw Object.assign(new Error(attachmentNotFound), { status: 404 });
       }
          else
          throw Object.assign(new Error(errorMessage), { status: 500 });
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
        if (targetDef && targetDef.includes && (targetDef.includes.includes('sap.attachments.Attachments') || targetDef.includes.includes('Attachments'))) {
          attachmentCompositions.push(elementName);
        }
      }
    }

    return attachmentCompositions;
  }

  async draftEntityRenameHandler(req) {
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
        const errorResponse = await this.updateDraftAttachments(req, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName);
        allErrors = allErrors.concat(errorResponse);
      }

      // Updating non-draft attachments
      for (const attachment of attachment_val_rename) {
        const errorResponse = await this.updateNonDraftAttachments(req, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName);
        allErrors = allErrors.concat(errorResponse);
      }

      this.clearSecondaryPropertiesCache(repositoryId);

      const errorMessage = this.handleWarning(allErrors, propertyTitles);
      if(errorMessage.length != 0){
        req.warn(500, errorMessage);
      }
    }
  }

  async updateDraftAttachments(req, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName) {
    const attachmentData = await this.getAttachementDataInSDM(this.creds.uri, attachment.url, req);
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

    return this._updateAttachments(req, context);
  }

  async updateNonDraftAttachments(req, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, compositionName) {
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

    return this._updateAttachments(req, context);
  }

  async _updateAttachments(req, context) {
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

    const noteInDB = await this._getNoteFromDB(attachmentsEntity, attachment.ID);
    const noteInRequest = attachment.note ?? null;
    if (noteInRequest !== noteInDB) {
      updatedSecondaryProperties["cmis:description"] = noteInRequest;
    }

    if (Object.keys(updatedSecondaryProperties).length > 0) {
      const updateResult = await this.performAttachmentUpdate(
        req, attachment, updatedSecondaryProperties, invalidDefinitions, filenameInRequest
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

  async performAttachmentUpdate(req, attachment, updatedSecondaryProperties, invalidDefinitions, filenameInRequest) {
    try {
      const destination = await this.getDestination(req);
      const responseCode = await updateAttachment(req, attachment, this.creds, destination, updatedSecondaryProperties, invalidDefinitions);

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
    
    let attachment;
    
    // First try composition-based update (batch updates via parent entity)
    if (compositionName && req.data[compositionName]) {
      attachment = req.data[compositionName].find(element => element.ID === id);
    } 
    // Fallback to direct PATCH operation on attachment entity (non-draft support)
    else if (req.data.ID === id) {
      attachment = req.data;
    }
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

  async getAttachementDataInSDM(uri, objectId, req) {
    const destination = await this.getDestination(req);
    const response = await getAttachment(uri, destination, objectId);
    const responseData = { filename: response?.data?.succinctProperties["cmis:name"], folderId: response?.data?.succinctProperties["sap:parentIds"][0] };
    return responseData;
  }

  /**
   * Returns a handler to copy updated attachments content from draft to active / SDM
   * This overrides the parent class method to provide SDM-specific behavior
   * @param {import('@sap/cds').Entity} attachments - Attachments entity definition
   * @returns {Function} - The draft save handler function
   */
  draftSaveHandler(attachments) {
    // Call parent's draftSaveHandler to get the base handler
    const parentHandler = super.draftSaveHandler(attachments);
    
    // Return a handler that executes parent logic
    return async (res, req) => {
      // Execute parent's draft save logic
      await parentHandler(res, req);
      // Add any SDM-specific logic here if needed in the future
    }
  }

  /**
   * Handler for PUT operations on draft attachments (file upload)
   * This is separate from draftSaveHandler and handles the actual file upload to SDM
   */
  /**
   * Handles file upload for draft attachments
   * Called on PUT of draft attachment entity (e.g., attachments.drafts)
   * @param {import('@sap/cds').Request} req - The request object
   */
  async draftAttachmentUploadHandler(req) {

    if (req?.data?.content) {
      // Read actual file size from HTTP Content-Length header so the chunked
      // upload path can be selected before the stream is consumed.
      const rawContentLength = req.req?.headers?.['content-length'] || req.headers?.['content-length'];
      const contentLengthNum = rawContentLength ? parseInt(rawContentLength, 10) : -1;

      console.log(`[draftAttachmentUploadHandler] Upload started — Content-Length: ${contentLengthNum} bytes`);

      // Check virus scan before any SDM call — reject large files early.
      if (contentLengthNum > FILE_SIZE_THRESHOLD) {
        const isVirusScanEnabled = cds.env?.requires?.["sdm"]?.settings?.isVirusScanEnabled;
        if (isVirusScanEnabled === 'true' || isVirusScanEnabled === true) {
          console.error(`[draftAttachmentUploadHandler] Rejecting: file size ${contentLengthNum} exceeds 400MB limit for virus scan enabled repository`);
          req.reject(409, largFileVirusScanErr);
        }
      }

      const { repositoryId } = getConfigurations();
      await this.checkRepositoryType(req, contentLengthNum);
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
        let attachment_val_create = [];
        if (req.data.content) {
          attachment_val_create = attachment_val.filter(attachment => attachment.HasActiveEntity === false && attachment.ID === attachmentID);
        }
        if (attachment_val_create.length > 0) {
          attachment_val_create[0].content = req.data.content;
          attachment_val_create[0].contentLength = contentLengthNum;
          await this.create(attachment_val_create, draftAttachments, req);
          console.log(`[draftAttachmentUploadHandler] Upload finished`);
        }
      }
      req.data.content = null;
    }
  }

  async create(attachment_val_create, attachments, req){
    let parentId = await this.getParentId(attachments, req, undefined);
    await this.onCreate(
      attachment_val_create,
      this.creds,
      req,
      parentId
    );
  }

  async getParentId(attachments, req, upId){
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
      const destination = await this.getDestination(req);
      const folderId = await getFolderIdByPath(
        req,
        this.creds,
        attachments,
        upId,
        destination
      );
      if (folderId) {
        parentId = folderId;
      } else {
        const response = await createFolder(
          req,
          this.creds,
          attachments,
          upId,
          destination
        );
        if (response.status == 403 && response.response.data == userDoesNotHaveRequiredScope) {
          console.error('[getParentId] User not authorized to create folder');
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
    if (this.getSDMCredentials()) {
    const attachmentCompositions = this.getAttachmentCompositions(req.target);

    for (const compositionName of attachmentCompositions) {
      const attachments = cds.model.definitions[req.target.name + "." + compositionName];
      if (attachments) {
        const diffData = await req.diff();
        await this.processAttachmentDeletion(req, diffData, compositionName, attachments);
      }
    }
    }
  }

  async processAttachmentDeletion(req, diffData, compositionName, attachments) {
    // For DELETE events, ALWAYS get the folder ID first (even if no attachments to delete)
    // This ensures folder cleanup happens for entities with zero attachments
    if (req.event === "DELETE") {
      await this.addFolderToParentIdList(req, attachments);
    }
    
    // Now handle attachment deletion if there are any
    if (!diffData?.[compositionName]?.length) {
      return;
    }

    const deletedAttachments = this.extractDeletedAttachmentIds(diffData[compositionName]);

    if (deletedAttachments.length > 0) {
      await this.addAttachmentsToDeleteList(req, deletedAttachments, attachments);
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
    const destination = await this.getDestination(req);
    const folderId = await getFolderIdByIDAsPath(
      req,
      this.creds,
      destination,
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

          const destination = await this.getDestination(req);
          const folderId = await getFolderIdByIDAsPath(
            req,
            this.creds,
            destination,
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
       if (req?.parentId) {
        // Handle both single parentId and array of parentIds
        const destination = await this.getDestination(req);
        const parentIds = Array.isArray(req.parentId) ? req.parentId : [req.parentId];
        for (const parentId of parentIds) {
          await deleteFolderWithAttachments(this.creds, destination, parentId);
        }
      } else {
        const destination = await this.getDestination(req);
        const deletePromises = req.attachmentsToDelete.map(
          async (attachment) => {
            const deleteAttachmentResponse = await deleteAttachmentsOfFolder(
              this.creds,
              destination,
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
        // Handle both single parentId and array of parentIds
        const destination = await this.getDestination(req);
        const parentIds = Array.isArray(req.parentId) ? req.parentId : [req.parentId];
        for (const parentId of parentIds) {
          await deleteFolderWithAttachments(this.creds, destination, parentId);
        }
      }
    }
  }

  async onCreate(data, credentials, req, parentId) {
    let fileNames = [];
    const { repositoryId } = getConfigurations();
    const destination = await this.getDestination(req);
    await Promise.all(
      data.map(async (d) => {
        let response;
        try {
          response = await createAttachment(
            d,
            credentials,
            parentId,
            destination
          );
        } catch (error) {
          // Handle Axios errors from SDM (e.g., 409 for duplicates)
          console.error('[onCreate] createAttachment threw error', {
            filename: d.filename,
            status: error.response?.status,
            errorMessage: error.response?.data?.message,
            errorException: error.response?.data?.exception,
            isAxiosError: error.isAxiosError
          });
          // Convert axios error to response object for consistent handling
          response = {
            status: error.response?.status || 500,
            response: error.response
          };
        }
        
        if (response.status == 201) {
          d.folderId = parentId;
          d.url = response.data?.succinctProperties["cmis:objectId"];
          d.repositoryId = repositoryId;
          d.content = null;
          d.type = 'sap-icon://document';
          
          // For draft entities, use updateAttachmentInDraft
          // For non-draft entities, update directly using the ID
          if (req.target.isDraft) {
            await updateAttachmentInDraft(req, d);
          } else if (d.ID) {
            // Use UPDATE directly to work within the ambient transaction context
            try {
              await cds.ql.UPDATE(req.target)
                .set({ 
                  folderId: d.folderId, 
                  url: d.url, 
                  repositoryId: d.repositoryId,
                  status: "Clean", 
                  type: d.type 
                })
                .where({ ID: d.ID });
            } catch (updateError) {
              console.error('[onCreate] UPDATE failed for non-draft attachment', {
                ID: d.ID,
                error: updateError.message,
                stack: updateError.stack
              });
              throw updateError;
            }
          } else {
            console.warn('[onCreate] No update performed - missing ID', {
              filename: d.filename,
              isDraft: req.target.isDraft
            });
          }
        } else {
          console.error('[onCreate] Upload failed', {
            filename: d.filename,
            status: response.status,
            errorMessage: response.response?.data?.message,
            errorException: response.response?.data?.exception
          });
          fileNames.push(d.filename);
          
          // For non-draft entities, delete the orphaned metadata record
          // that was created during the POST request before SDM upload failed
          if (!req.target.isDraft && d.ID) {
            try {
              await cds.ql.DELETE.from(req.target).where({ ID: d.ID });
            } catch (cleanupError) {
              console.error('[onCreate] Cleanup failed', {
                ID: d.ID,
                error: cleanupError.message
              });
            }
          }
          
          if(response.response.data.message == 'Malware Service Exception: Virus found in the file!'){
            console.error('[onCreate] Virus detected', { fileNames });
            req.reject(403, virusFileErr(fileNames));
          }
          else if(response.response.data.exception == "nameConstraintViolation"){
            const duplicateErrorMessage = duplicateFileErr(fileNames);
            console.error('[onCreate] Duplicate file detected', { 
              fileNames,
              sdmMessage: response.response.data.message,
              sdmException: response.response.data.exception,
              formattedErrorMessage: duplicateErrorMessage
            });
            req.reject(409, duplicateErrorMessage);
          }
          else if(response.status == 403 && response.response?.data?.exception === 'streamNotSupported'){
            console.error('[onCreate] Blocked MIME type', { fileNames, message: response.response?.data?.message });
            req.reject(403, mimeTypeInvalidError);
          }
          else if(response.status == 403){
            console.error('[onCreate] User not authorized', { fileNames });
             req.reject(403, userNotAuthorisedError);
          }
          else{
            console.error('[onCreate] Other upload error', { 
              fileNames,
              status: response.status,
              message: response.response?.data?.message
            });
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

         const destination = await this.getDestination(req);
         const authresponse = await getAttachment(this.creds.uri, destination, objectId);
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


    await this.processLinkCreation(linkToCreateInSDM, attachment, req);

  }

  async processLinkCreation(linkToCreateInSDM, attachment, req) {
    const upIdKey = attachment.keys.up_.keys[0].$generatedFieldName;
    const upId = req.req.url.match(attachmentIDRegex)[1];

    console.info(`[processLinkCreation] called`, {
      upIdKey,
      upId,
      linkToCreateInSDM
    });

    let parentId = await this.getParentId(attachment, req, upId);

    console.info(`[processLinkCreation] parentId resolved`, {
      parentId
    });

    await this.createLink(
      linkToCreateInSDM,
      this.creds,
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

  async createLink(linkToCreateInSDM, credentials, req, parentId, upIdKey) {
    const { repositoryId } = getConfigurations();
    const upId = req.req.url.match(attachmentIDRegex)[1];

    console.info(`[createLink] called`, {
      linkToCreateInSDM,
      parentId,
      upIdKey,
      upId
    });

    // Process single link object
    const destination = await this.getDestination(req);
    const response = await createAttachment(
      linkToCreateInSDM,
      credentials,
      parentId,
      destination
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
        mimeType: "application/internet-shortcut",
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
    const filenameToUpdate = existingAttachment.filename.replace(/\.url$/, '');
    const objectIdToUpdate = existingAttachment.url;
    const destination = await this.getDestination(req);
    const response = await editLink(objectIdToUpdate, filenameToUpdate, newLinkUrl, this.creds, destination);
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

  async handleDraftSaveForLinks(data, req) {
    const baseEntityName = req.target.name;
    const attachmentCompositions = this.getAttachmentCompositions({ name: baseEntityName });
    const parentId = req.data?.ID;

    for (const compositionName of attachmentCompositions) {
      const attachmentsEntityName = `${baseEntityName}.${compositionName}`;
      const attachmentsEntity = cds.model.definitions[attachmentsEntityName];
      if (!attachmentsEntity) continue;

      const upKey = attachmentsEntity.keys?.up_?.keys?.[0]?.$generatedFieldName || 'up__ID';

      // Fix mimeType for link attachments of this specific entity
      if (parentId) {
        await global.UPDATE(attachmentsEntityName)
          .set({ mimeType: 'application/internet-shortcut' })
          .where({
            [upKey]: parentId,
            linkUrl: { '!=': null },
            mimeType: { '!=': 'application/internet-shortcut' }
          });
      }

      await this.updateBaselinesForEntity(attachmentsEntityName);
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
            await this.revertLinkInSDM(attachment, baselineUrl, req);
            const attachmentKey = `${attachment.ID}`;
            this.originalUrlMap.delete(attachmentKey);
          }
        }
      }
    }
  }

  async revertLinkInSDM(draftAttachment, originalLinkUrl, req) {
    try {
      const filenameToUpdate = draftAttachment.filename.replace(/\.url$/, '');
      const objectIdToUpdate = draftAttachment.url;
      const destination = await this.getDestination(req);

      await editLink(
        objectIdToUpdate,
        filenameToUpdate,
        originalLinkUrl,
        this.creds,
        destination
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

  /**
   * Get the malware scan status of an attachment
   * Required by @cap-js/attachments to validate attachment access
   * SDM plugin doesn't use malware scanning, so always returns clean status
   * @param {import('@sap/cds').Entity} Attachments - The attachment entity
   * @param {object} key - The key object with ID
   * @returns {Promise<{status: string, lastScan: Date}>} The scan status and last scan timestamp
   */
  // eslint-disable-next-line no-unused-vars
  async getStatus(_Attachments, _key) {
    // SDM doesn't use malware scanning - return clean status to satisfy API contract
    return { status: "Clean", lastScan: null };
  }

  /**
   * Handler for CREATE operations on non-draft attachments only
   * Draft entities skip this handler - uploads are handled by draftPutHandler
   * 
   * Note: Unlike attachments plugin which returns AttachmentsSrv.put() and bypasses
   * the default handler, this handler uploads to SDM then continues to let CAP's
   * default handler create the DB record with metadata.
   * 
   * @param {import('@sap/cds').Request} req - The request object
   */
  async nonDraftAttachmentCreateHandler(req) {
    // Skip if no content or if this is a draft entity (handled by draftPutHandler)
    if (!req.data.content || req.target.isDraft) return;

    const rawContentLength = req.req?.headers?.['content-length'] || req.headers?.['content-length'];
    const contentLengthNum = rawContentLength ? parseInt(rawContentLength, 10) : -1;

    await this.checkRepositoryType(req, contentLengthNum);

    // For PUT operations (content upload), fetch existing metadata from DB
    let filename = req.data.filename;
    let attachmentID = req.data.ID;
    let metadata = null;

    if (req.event === 'UPDATE' || req.event === 'PUT') {
      attachmentID = req.req.url.match(attachmentIDRegex)[1];

      metadata = await cds.ql.SELECT.one.from(req.target)
        .where({ ID: attachmentID });

      if (!metadata) {
        return req.reject(404, 'Attachment not found');
      }

      filename = metadata.filename;
      attachmentID = metadata.ID;

      for (const key in metadata) {
        if (key.startsWith('up_')) {
          req.data[key] = metadata[key];
        }
      }
    }

    if (isRestrictedCharactersInName(filename)) {
      return req.reject(409, nameConstrainErr([filename], "Upload"));
    }

    if (filename == null || filename.trim().length === 0) {
      return req.reject(400, emptyFileNameErr);
    }

    const parentId = await this.getParentId(req.target, req, undefined);

    const attachmentData = [{
      ...req.data,
      ID: attachmentID,
      filename: filename,
      content: req.data.content,
      contentLength: contentLengthNum,
    }];

    await this.onCreate(attachmentData, this.creds, req, parentId);

    const updatedRecord = await cds.ql.SELECT.one.from(req.target).where({ ID: attachmentID });
    if (updatedRecord) {
      req.data.url = updatedRecord.url;
      req.data.folderId = updatedRecord.folderId;
      req.data.repositoryId = updatedRecord.repositoryId;
      req.data.status = updatedRecord.status;
      req.data.type = updatedRecord.type;
    }

    req.data.content = null;
  }

  /**
   * Handler for direct UPDATE operations on non-draft attachment entities
   * Called on PATCH/UPDATE of attachment entity directly (e.g., Projects.references)
   * @param {import('@sap/cds').Request} req - The request object
   */
  async nonDraftAttachmentUpdateHandler(req) {
    // Skip if this is a draft entity
    if (req.target.isDraft) {
      return;
    }

    // Skip if this is a PUT /content operation (handled by nonDraftAttachmentCreateHandler)
    if (req.data.content) {
      return;
    }

    // Skip if filename is not being changed and no custom properties
    if (!('filename' in req.data) && Object.keys(req.data).length <= 1) {
      return;
    }

    // Get attachment entity definition
    const attachmentsEntity = cds.model.definitions[req.target.name];
    const attachmentID = req.data.ID;
    
    // Get current attachment from database
    const currentAttachment = await cds.ql.SELECT.one.from(req.target).where({ ID: attachmentID });
    
    if (!currentAttachment) {
      return req.reject(404, 'Attachment not found');
    }

    // Merge request data with current attachment for validation
    const attachmentToUpdate = { ...currentAttachment, ...req.data };

    // Get validation data
    const secondaryTypeProperties = getSecondaryTypeProperties(attachmentsEntity, attachmentToUpdate);
    const secondaryPropertiesWithInvalidDefinitions = getSecondaryPropertiesWithInvalidDefinition(
      attachmentsEntity,
      attachmentToUpdate
    );

    // Create context object matching the expected signature
    const context = {
      attachment: attachmentToUpdate,
      attachmentsEntity,
      filenameInSDM: currentAttachment.filename,
      compositionName: attachmentsEntity.name,
      secondaryProperties: {
        invalidDefinitions: secondaryPropertiesWithInvalidDefinitions,
        typeProperties: secondaryTypeProperties
      }
    };

    // Use the existing _updateAttachments method which handles all validation and SDM updates
    const failedReq = await this._updateAttachments(req, context);

    // Handle errors using req.reject (direct operation pattern)
    if (failedReq && failedReq.length > 0) {
      const error = failedReq[0];
      
      if (error.typeOfError === 'restricted characters') {
        req.reject(409, nameConstrainErr([error.name], "Update"));
      } else if (error.typeOfError === 'empty name') {
        req.reject(400, emptyFileNameErr);
      } else if (error.typeOfError === 'duplicate') {
        req.reject(409, duplicateFileErr([error.name]));
      } else if (error.typeOfError === 'no sdm roles') {
        req.reject(403, userNotAuthorisedError);
      } else if (error.typeOfError === 'not found') {
        req.reject(404, renameFileErr([error.name], getStatusCondition(404)));
      } else if (error.typeOfError === 'unsupported properties') {
        // Parse CMIS property IDs from error.details (comma-separated string)
        const cmisPropertyIds = error.details.split(',').map(name => name.trim());
        
        // For unsupported properties, we warn but don't reject (matches draft behavior)
        // The properties couldn't be updated, but the operation should still succeed
        const warningMessage = unsupportedPropertiesErrorMessage(cmisPropertyIds);
        req.warn(warningMessage);
        // Continue - don't reject, just warn
      } else if (error.typeOfError === 'bad request') {
        req.reject(500, error.message || renameOtherFilesErr([error.name], ['Update failed']));
      } else {
        req.reject(500, 'Update failed');
      }
    }
  }

  /**
   * Handles rename/metadata updates for non-draft entities
   * Called on UPDATE of parent entity (e.g., Documents)
   * Similar to draftEntityRenameHandler but for non-draft entities
   * 
   * Note: This handler updates metadata (filename, properties) in SDM. 
   * 
   * @param {import('@sap/cds').Request} req - The request object
   */
  async nonDraftEntityRenameHandler(req) {
    const { repositoryId } = getConfigurations();
    const attachmentsEntity = cds.model.definitions[req.target.name + ".attachments"];
    
    if (!attachmentsEntity) return;

    const updatedAttachments = await this._getUpdatedAttachments(req);
    if (!updatedAttachments || updatedAttachments.length === 0) return;

    const validationContext = this._prepareValidationContext(attachmentsEntity, updatedAttachments[0]);
    const allErrors = await this._processAttachmentUpdates(req, updatedAttachments, attachmentsEntity, validationContext);

    this._handleUpdateResults(req, repositoryId, allErrors, validationContext.propertyTitles);
  }

  /**
   * Extracts attachments that need to be updated from diff data
   * @private
   */
  async _getUpdatedAttachments(req) {
    const diffData = await req.diff();
    if (!diffData?.attachments?.length) return null;

    const updatedAttachments = diffData.attachments.filter(att => 
      !att._op || att._op === 'update'
    );

    return updatedAttachments.length > 0 ? updatedAttachments : null;
  }

  /**
   * Prepares validation context with property definitions
   * @private
   */
  _prepareValidationContext(attachmentsEntity, sampleAttachment) {
    return {
      propertyTitles: getPropertyTitles(attachmentsEntity, sampleAttachment),
      invalidDefinitions: getSecondaryPropertiesWithInvalidDefinition(attachmentsEntity, sampleAttachment),
      typeProperties: getSecondaryTypeProperties(attachmentsEntity, sampleAttachment)
    };
  }

  /**
   * Processes all attachment updates and collects errors
   * @private
   */
  async _processAttachmentUpdates(req, updatedAttachments, attachmentsEntity, validationContext) {
    const allErrors = [];

    for (const attachment of updatedAttachments) {
      const error = await this._processNonDraftAttachmentUpdate(
        req, 
        attachment, 
        attachmentsEntity, 
        validationContext
      );
      
      if (error) {
        allErrors.push(error);
      }
    }

    return allErrors;
  }

  /**
   * Processes a single non-draft attachment update
   * @private
   */
  async _processNonDraftAttachmentUpdate(req, attachment, attachmentsEntity, validationContext) {
    const currentAttachment = await this._fetchCurrentAttachment(
      attachmentsEntity, 
      attachment.ID, 
      validationContext.typeProperties
    );

    if (!currentAttachment) return null;

    const propertiesInDB = await getPropertiesForID(
      attachmentsEntity, 
      attachment.ID, 
      validationContext.typeProperties
    );

    const updatedSecondaryProperties = getUpdatedSecondaryProperties(
      attachment, 
      validationContext.typeProperties, 
      propertiesInDB
    );

    const newFilename = attachment.filename || currentAttachment.filename;

    // Validate filename
    const validationError = this.validateFilename(newFilename);
    if (validationError) return validationError;

    // Add filename to updates if changed
    if (currentAttachment.filename !== newFilename) {
      updatedSecondaryProperties["cmis:name"] = newFilename;
    }

    // Map note → cmis:description when changed
    const noteInDB = await this._getNoteFromDB(attachmentsEntity, attachment.ID);
    const noteInRequest = attachment.note ?? null;
    if (noteInRequest !== noteInDB) {
      updatedSecondaryProperties["cmis:description"] = noteInRequest;
    }

    // Update in SDM if there are changes
    if (Object.keys(updatedSecondaryProperties).length > 0) {
      return await this._updateAttachmentInSDM(
        req,
        currentAttachment,
        attachment,
        updatedSecondaryProperties,
        validationContext.invalidDefinitions,
        newFilename
      );
    }

    return null;
  }

  /**
   * Fetches current attachment from database
   * @private
   */
  async _fetchCurrentAttachment(attachmentsEntity, attachmentID, secondaryTypeProperties) {
    const columns = ['filename', 'url', 'note', ...Object.keys(secondaryTypeProperties)];
    return await cds.ql.SELECT.one.from(attachmentsEntity)
      .where({ ID: attachmentID })
      .columns(...columns);
  }

  async _getNoteFromDB(attachmentsEntity, attachmentID) {
    const row = await cds.ql.SELECT.one.from(attachmentsEntity)
      .where({ ID: attachmentID })
      .columns('note');
    return row?.note ?? null;
  }

  /**
   * Updates attachment in SDM and maps response to error object
   * @private
   */
  async _updateAttachmentInSDM(req, currentAttachment, attachment, updatedProperties, invalidDefinitions, filename) {
    try {
      const destination = await this.getDestination(req);
      const responseCode = await updateAttachment(
        req, 
        { ...currentAttachment, ...attachment }, 
        this.creds, 
        destination, 
        updatedProperties, 
        invalidDefinitions
      );

      return this._mapResponseCodeToError(responseCode, filename);
    } catch (error) {
      return this._mapExceptionToError(error, filename);
    }
  }

  /**
   * Maps SDM response code to error object
   * @private
   */
  _mapResponseCodeToError(responseCode, filename) {
    switch (responseCode) {
      case 403:
        return { typeOfError: 'no sdm roles', name: filename };
      case 409:
        return { typeOfError: 'duplicate', name: filename };
      case 404:
        return { typeOfError: 'not found', name: filename };
      default:
        return null;
    }
  }

  /**
   * Maps exception to error object
   * @private
   */
  _mapExceptionToError(exception, filename) {
    if (exception.message.startsWith(unsupportedProperties)) {
      const unsupportedDetails = exception.message.substring(unsupportedProperties.length).trim();
      return { typeOfError: 'unsupported properties', details: unsupportedDetails };
    }
    
    return { typeOfError: 'bad request', name: filename, message: exception.message };
  }

  /**
   * Handles update results by clearing cache and displaying warnings
   * @private
   */
  _handleUpdateResults(req, repositoryId, allErrors, propertyTitles) {
    this.clearSecondaryPropertiesCache(repositoryId);

    const errorMessage = this.handleWarning(allErrors, propertyTitles);
    if (errorMessage.length !== 0) {
      req.warn(500, errorMessage);
    }
  }

  /**
   * Handler for non-draft attachment entity deletion
   * @param {import('@sap/cds').Request} req - The request object
   */
  async attachNonDraftAttachmentDeletionData(req) {
    if (!req.target?.["@_is_media_data"]) return;
    if (!req.subject) return;

    const attachments = await cds.ql.SELECT.from(req.subject).columns("url", "ID");
    if (attachments.length) {
      req.attachmentsToDelete = attachments.map(a => ({ ...a, target: req.target.name }));
    }
  }

  registerHandlers(srv) {
    // First call the parent registerHandlers to ensure base functionality is registered
    if (super.registerHandlers) {
      super.registerHandlers(srv);
    }

    // Get all entities with attachments compositions
    Object.values(srv.entities).forEach((entity) => {
      for (let elementName in entity.elements) {
        if (elementName === "SiblingEntity") continue;
        const element = entity.elements[elementName], target = element._target;
        if (target?.["@_is_media_data"]) {
          // Register SDM-specific handlers for both draft and non-draft entities
          this.registerSDMHandlers(srv, entity, target);
        }
      }
    });
  }



  registerSDMHandlers(srv, entity, target) {
    // Handle DELETE and UPDATE for both draft and non-draft entities
    srv.before(
      ["DELETE","UPDATE"],
      entity,
      this.attachDeletionData.bind(this)
    );

    // Handle DELETE for draft entities
    if (entity.drafts) {
      srv.before(
        ["DELETE"],
        entity.drafts,
        this.attachDraftDeletionData.bind(this)
      );
    }
    // Handle DELETE on attachment entity (draft and non-draft)
    if (target.drafts) {
      srv.before(["DELETE"], target.drafts, this.attachURLsToDeleteFromAttachmentsDraft.bind(this));
    }
    
    // Handle direct DELETE on attachment entity
    srv.before(
      "DELETE",
      target,
      this.attachNonDraftAttachmentDeletionData.bind(this)
    );
    
    // Draft-specific handlers
    if (entity.drafts) {
      srv.before("DELETE", entity.drafts, this.handleDraftDiscardForLinks.bind(this));
      srv.after("SAVE", entity, this.handleDraftSaveForLinks.bind(this));
      srv.before("SAVE", entity, this.draftEntityRenameHandler.bind(this));
    } else {
      // Non-draft rename/update handler
      srv.before("UPDATE", entity, this.nonDraftEntityRenameHandler.bind(this));
    }
    
    // Repository filtering and settings (both draft and non-draft)
    const targets = target.drafts ? [target, target.drafts] : [target];
    srv.before("READ", targets, this.setRepository.bind(this));
    srv.before("READ", targets, this.filterAttachments.bind(this));
    
    // Handle PUT for draft attachments
    if (target.drafts) {
      srv.before(
        "PUT",
        target.drafts,
        this.draftAttachmentUploadHandler.bind(this)
      );
    } else {
      // Handle PUT for non-draft attachments (content upload)
      srv.before(
        "PUT",
        target,
        this.nonDraftAttachmentCreateHandler.bind(this)
      );
    }
    
    // Handle CREATE for non-draft attachments
    srv.before(
      "CREATE",
      target,
      this.nonDraftAttachmentCreateHandler.bind(this)
    );

    // Handle direct UPDATE/PATCH on non-draft attachment entity
    srv.before(
      "UPDATE",
      target,
      this.nonDraftAttachmentUpdateHandler.bind(this)
    );
    
    srv.after(
      ["DELETE","UPDATE"],
      entity.drafts ? [entity, entity.drafts] : [entity],
      this.deleteAttachmentsWithKeys.bind(this)
    );
    
    srv.after(
      "DELETE",
      target,
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
