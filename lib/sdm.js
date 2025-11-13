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
     if(content.status == 200){
      return content.data;
      }
    else{
       if(content.status == 403){
          req.reject(403, userNotAuthorisedReadError);
       }
       else if(content.status == 404){
          req.reject(404, attachmentNotFound);
       }
          else
          req.reject(500, errorMessage);
    }
  }


  async renameHandler(req) {
    const { repositoryId } = getConfigurations();
    const attachmentsEntity = cds.model.definitions[req.target.name + ".attachments"];
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
        const errorResponse = await this.updateDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties);
        allErrors = allErrors.concat(errorResponse);
      }

      // Updating non-draft attachments
      for (const attachment of attachment_val_rename) {
        const errorResponse = await this.updateNonDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties);
        allErrors = allErrors.concat(errorResponse);
      }

      this.clearSecondaryPropertiesCache(repositoryId);

      const errorMessage = this.handleWarning(allErrors, propertyTitles);
      if(errorMessage.length != 0){
        req.warn(500, errorMessage);
      }
    }
  }

  async updateDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties) {
    const attachmentData = await this.getAttachementDataInSDM(this.creds.uri, token, attachment.url);
    const filenameInSDM = attachmentData.filename;
    return this._updateAttachments(
      req,
      token,
      attachment,
      attachmentsEntity,
      secondaryPropertiesWithInvalidDefinitions,
      secondaryTypeProperties,
      filenameInSDM
    );
  }

  async updateNonDraftAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties) {
    const fileNameInDB = await getFileNameForAttachmentID(attachmentsEntity, attachment.ID);
    return this._updateAttachments(
      req,
      token,
      attachment,
      attachmentsEntity,
      secondaryPropertiesWithInvalidDefinitions,
      secondaryTypeProperties,
      fileNameInDB
    );
  }

  async _updateAttachments(req, token, attachment, attachmentsEntity, secondaryPropertiesWithInvalidDefinitions, secondaryTypeProperties, filenameInSDM) {
    let failedReq = [];
    const propertiesInDB = await getPropertiesForID(attachmentsEntity, attachment.ID, secondaryTypeProperties);
    const updatedSecondaryProperties = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);
    const filenameInRequest = attachment.filename;

    if (isRestrictedCharactersInName(filenameInRequest)) {
      failedReq.push({ typeOfError: 'restricted characters', name: filenameInRequest });
      this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, secondaryTypeProperties);
      return failedReq;
    }

    if (filenameInRequest == null || filenameInRequest.trim().length === 0) {
      failedReq.push({ typeOfError: 'empty name', name: filenameInRequest });
      this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, secondaryTypeProperties);
      return failedReq;
    } else if (filenameInSDM !== filenameInRequest) {
      updatedSecondaryProperties["cmis:name"] = filenameInRequest;
    }

    if (Object.keys(updatedSecondaryProperties).length > 0) {
      try {
        const responseCode = await updateAttachment(req, attachment, this.creds, token, updatedSecondaryProperties, secondaryPropertiesWithInvalidDefinitions);

        switch (responseCode) {
          case 403:
            failedReq.push({ typeOfError: 'no sdm roles', name: filenameInRequest });
            this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, secondaryTypeProperties);
            break;

          case 409:
            failedReq.push({ typeOfError: 'duplicate', name: filenameInRequest });
            this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, secondaryTypeProperties);
            break;

          case 404:
            failedReq.push({ typeOfError: 'not found', name: filenameInRequest });
            this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, secondaryTypeProperties);
            break;

          case 200:
          case 201:
            // Success cases, do nothing
            break;

          default:
            throw new Error(sdmRolesErrorMessage);
        }
      } catch (e) {
        if (e.message.startsWith(unsupportedProperties)) {
          const unsupportedDetails = e.message.substring(unsupportedProperties.length).trim();
          failedReq.push({ typeOfError: 'unsupported properties', details: unsupportedDetails });
          this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, secondaryTypeProperties);
        } else {
          failedReq.push({ typeOfError: 'bad request', name: filenameInRequest, message: e.message });
          this.replacePropertiesInAttachment(req, attachment.ID, filenameInSDM, propertiesInDB, secondaryTypeProperties);
        }
      }
    }

    return failedReq;
  }

  replacePropertiesInAttachment(req, id, fileName, propertiesInDB, secondaryTypeProperties) {
    const attachment = req.data.attachments.find(element => element.ID === id);
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
    const attachments =
      cds.model.definitions[req.target.name + ".attachments"];
    if (attachments) {
      const diffData = await req.diff();
      let deletedAttachments = [];
     if (diffData?.attachments?.length > 0) {
        diffData.attachments
          .filter((object) => {
            return object._op === "delete";
          })
          .map((attachment) => {
            deletedAttachments.push(attachment.ID);
          });
        if (deletedAttachments.length > 0) {
          const attachmentsToDelete = await getURLsToDeleteFromAttachments(
            deletedAttachments,
            attachments
          );
          if (attachmentsToDelete.length > 0) {
            req.attachmentsToDelete = attachmentsToDelete;
          }
        }
        if (req.event == "DELETE") {
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
            req.parentId = folderId;
          }
        }
      }
    }
  }

  async attachDraftDeletionData(req) {
    let draftAttachments = cds.model.definitions[req.target.name.replace(/\.drafts$/, ".attachments.drafts")];
    if(draftAttachments)  {
      const attachmentsToDeleteFromDraft = await getURLsToDeleteFromDraftAttachments(req.data.ID, draftAttachments);
      if (attachmentsToDeleteFromDraft?.length > 0) {
        req.attachmentsToDelete = attachmentsToDeleteFromDraft;
      }
      const diffData = await req.diff();
      if (req.event == "DELETE" && diffData.attachments?.length == req.attachmentsToDelete?.length) {
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
          req.parentId = folderId;
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
        await deleteFolderWithAttachments(this.creds, token, req.parentId);
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
        await deleteFolderWithAttachments(this.creds, token, req.parentId);
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
      if(authresponse.status ==403){
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
      const updatedFields = {
        ID: attachmentId,
        linkUrl: newLinkUrl
      };
      await editLinkInDraft(req, updatedFields);
    } else if (status === 403) {
      console.warn(`[editLink] user not authorised`, { user: req.user?.id, response: response?.response?.data });
      req.reject(400, userNotAuthorisedErrorEditLink);
    } else {
      console.error(`[editLink] other error`, { message: response?.response?.data?.message, response: response.response.data });
      req.reject(response?.response?.data?.message);
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
