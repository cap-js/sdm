const cds = require("@sap/cds/lib");
const NodeCache = require("node-cache");
const cache = new NodeCache();
const {
  getRepositoryInfo,
  getFolderIdByPath,
  createFolder,
  createAttachment,
  deleteAttachmentsOfFolder,
  deleteFolderWithAttachments,
  getAttachment,
  readAttachment,
  renameAttachment
} = require("./handler/index");
const {
  fetchAccessToken,
  checkAttachmentsToRename,
  isRepositoryVersioned,
  getConfigurations,
  getClientCredentialsToken
} = require("./util/index");
const {
  getDraftAttachments,
  getDraftAttachmentsForUpID,
  getURLsToDeleteFromAttachments,
  getURLsToDeleteFromDraftAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
  updateAttachmentInDraft,
  setRepositoryId
} = require("../lib/persistence");
const { duplicateDraftFileErr, renameFileErr, virusFileErr, duplicateFileErr, versionedRepositoryErr, otherFileErr, userDoesNotHaveRequiredScope, userNotAuthorisedError } = require("./util/messageConsts");

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
      const repoInfo = await getRepositoryInfo(this.creds, token);
      isVersioned = await isRepositoryVersioned(repoInfo, repositoryId); 
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
    return content;
  }

  async renameHandler(req) {
    const { repositoryId } = getConfigurations();
    const attachments = cds.model.definitions[req.query.target.name + ".attachments"];
    const attachment_val = await getDraftAttachments(attachments, req, repositoryId);

    if (attachment_val.length > 0) {
      await this.isFileNameDuplicateInDrafts(attachment_val, req);

      const token = await fetchAccessToken(
        this.creds,
        req.user.tokenInfo.getTokenValue()
      );
      let attachment_val_rename = [];
      let draft_attachments = [];
      draft_attachments = attachment_val.filter(attachment => attachment.HasActiveEntity === false);
      attachment_val_rename = attachment_val.filter(attachment => attachment.HasActiveEntity === true);

      const attachmentIDs = attachment_val_rename.map(attachment => attachment.ID);
      let modifiedAttachments = [];

      modifiedAttachments = await checkAttachmentsToRename(attachment_val_rename, attachmentIDs, attachments)

      draft_attachments.forEach( attachment => {
        const filenameInDraft = attachment.filename;
        const objectId = attachment.url;
        const attachmentData = this.getAttachementDataInSDM(this.creds.uri, token, objectId);
        const filenameInSDM = attachmentData.filename;
        if(filenameInDraft !== filenameInSDM){
          modifiedAttachments.push({ID:attachment.ID, url: attachment.url, name: filenameInDraft, prevname: filenameInSDM, folderId:attachmentData.folderId});
        }
      });

      let errorMessage = ""
      if(modifiedAttachments.length>0){
        errorMessage =  await this.rename(modifiedAttachments, token, req)
      }
      
      if(errorMessage.length != 0){
        req.warn(500, errorMessage); 
      }
    }
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
        await this.isFileNameDuplicateInDrafts(attachment_val,req);
        const token = await fetchAccessToken(
          this.creds,
          req.user.tokenInfo.getTokenValue()
        );
        let attachment_val_create = [];
        if (req.data.content) {
          attachment_val_create = attachment_val.filter(attachment => attachment.HasActiveEntity === false && attachment.ID === req.data.ID);
        }
        if(attachment_val_create.length>0){
          attachment_val_create[0].content = req.data.content;
          await this.create(attachment_val_create, draftAttachments, req, token)
        } 
      }
      req.data.content = null;
    }
  }

  async rename(modifiedAttachments, token, req){
    const failedReq = await this.onRename(
      modifiedAttachments,
      this.creds,
      token,
      req
    );
    let errorResponse = "";
    failedReq.forEach((attachment) => {
      errorResponse = renameFileErr([attachment.name]);
    });
    return errorResponse;
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

  async getParentId(attachments,req,token){
    const { repositoryId } = getConfigurations();
    const folderIds = await getFolderIdForEntity(attachments, req, repositoryId);
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
        attachments
      );
      if (folderId) {
        parentId = folderId;
      } else {
        const response = await createFolder(
          req,
          this.creds,
          token,
          attachments
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
    let duplicates = [
      ...new Set(
        fileNames.filter((value, index, self) => {
          return self.indexOf(value) !== index;
        })
      ),
    ];
    if (duplicates.length != 0) {
      req.reject(409, duplicateDraftFileErr(duplicates.join(", ")));
    }
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
      cds.model.definitions[req.query.target.name];
    const { repositoryId } = getConfigurations(); // Fetch repositoryId from configurations
    await setRepositoryId(attachments, repositoryId)
  }

  async attachDeletionData(req) {
    const attachments =
      cds.model.definitions[req.query.target.name + ".attachments"];
    if (attachments) {
      const diffData = await req.diff();
      let deletedAttachments = [];
      if(diffData.attachments){
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
          const folderId = await getFolderIdByPath(
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
    let draftAttachments = cds.model.definitions[req.query.target.name.replace(/\.drafts$/, ".attachments.drafts")];
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
        const folderId = await getFolderIdByPath(
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

  async deleteAttachmentsWithKeys(records, req) {
    let failedReq = [],
      Ids = [];
    const token = await fetchAccessToken(
      this.creds,
      req.user.tokenInfo.getTokenValue()
    );
    if (req?.attachmentsToDelete?.length > 0) {
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
          await updateAttachmentInDraft(req, d);
        } else {
          fileNames.push(d.filename);
          if(response.response.data.message == 'Malware Service Exception: Virus found in the file!'){
            req.reject(403, virusFileErr(fileNames));
          }
          else if(response.response.data.exception == "nameConstraintViolation"){
            req.reject(409, duplicateFileErr(fileNames));
          }
          else{
            req.reject(otherFileErr(fileNames));
          }
        }
      })
    );
  }

  async onRename(modifiedAttachments, credentials, token, req) {
    let emptyNameExists = modifiedAttachments.some(attachment => attachment.name === "");
    if(emptyNameExists) {
      throw new Error("Filename cannot be empty");
    }
    let failedReq = [];

    await Promise.all(
      modifiedAttachments.map(async (a) => {
        const response = await renameAttachment(
          a,
          credentials,
          token
        );

        if (response.status != 200) {
          //modify req.data.attachments
          for(let i = 0; i < req.data.attachments.length; i++) {
            let attachmentUpdate = req.data.attachments[i];
            if(a.ID == attachmentUpdate.ID){
              attachmentUpdate.filename = a.prevname;
              req.data.attachments[i] = attachmentUpdate;
            }
          }

          failedReq.push({typeOfError:'duplicate',name:a.name})
        }
      })
    );


    return failedReq;
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
      ["DELETE", "UPDATE"],
      entity,
      this.attachDeletionData.bind(this)
    );
    srv.before(
      ["DELETE", "UPDATE"],
      entity.drafts,
      this.attachDraftDeletionData.bind(this)
    );
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
      ["DELETE", "UPDATE"],
      [entity, entity.drafts],
      this.deleteAttachmentsWithKeys.bind(this)
    );
  }
};
