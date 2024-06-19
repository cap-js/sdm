const cds = require("@sap/cds/lib");
const {
  getFolderIdByPath,
  createFolder,
  createAttachment,
  updateProperties,
  deleteAttachmentsOfFolder,
  deleteFolderWithAttachments,
  readAttachment,
  setContentStream,
  isRepositoryVersioned
} = require("../lib/handler");
const { fetchAccessToken } = require("./util/index");
const {
  getDraftAttachments,
  getActiveAttachments,
  getURLsToDeleteFromAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
} = require("../lib/persistence");
const { duplicateDraftFileErr, emptyFileErr } = require("./util/messageConsts");

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

  async get(attachments, keys, req) {
    const response = await getURLFromAttachments(keys, attachments);
    const token = await fetchAccessToken(
      this.creds,
      req.user.tokenInfo.getTokenValue()
    );
    try {
      const Key = response?.url;
      const content = await readAttachment(Key, token, this.creds);
      return content;
    } catch (error) {
      throw new Error(error);
    }
  }

  async draftSaveHandler(req) {
    const attachments =
      cds.model.definitions[req.query.target.name + ".attachments"];
      // if(req.event == 'UPDATE'){
      //   //fetch the active attachments
      //   const active_attachments = await getActiveAttachments(attachments, req);
      //   let activeAttachmentsArray = req.data.attachments.filter(attachment => !active_attachments.includes(attachment.filename));
      //   req.data.attachments.map(attachment => {
      //     active_attachments.map(item => {
      //         if(attachment === item) {
      //             console.log('Item exists!');
      //         }
      //     });
      // });
      //   //call the update properties api
      //   await Promise.all(
      //     activeAttachmentsArray.map(async (d) => {
      //         const response = await updateProperties(
      //           d,
      //           credentials,
      //           token
      //         );
      //       }
      // )
      //   );
      // }
    const attachment_val = await getDraftAttachments(attachments, req);
    if (attachment_val.length > 0) {
      const token = await fetchAccessToken(
        this.creds,
        req.user.tokenInfo.getTokenValue()
      );
      console.log(token)


      //verify if duplicate files are added in drafts
      const duplicateDraftFilesErrMsg =
        this.isFileNameDuplicateInDrafts(attachment_val);
      if (duplicateDraftFilesErrMsg != "") {
        req.reject(409, duplicateDraftFileErr(duplicateDraftFilesErrMsg));
      }

      console.log("TOKEN "+token);
      const folderIds = await getFolderIdForEntity(attachments, req);
      let parentId = "";
      if (folderIds?.length == 0) {
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
          parentId = response.data.succinctProperties["cmis:objectId"];
        }
      } else {
        parentId = folderIds ? folderIds[0].folderId : "";
      }
      const failedReq = await this.onCreate(
        attachment_val,
        this.creds,
        token,
        attachments,
        req,
        parentId
      );
      let errorResponse = "";
      failedReq.forEach((attachment) => {
        attachment = attachment.replace("Child", "");
        errorResponse = errorResponse + "\n" + attachment;
      });
      if (errorResponse != "") req.info(200, errorResponse);
    }

  }

  isFileNameDuplicateInDrafts(data) {
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
    return duplicates.join(", ");
  }

  async attachDeletionData(req) {
    const attachments =
      cds.model.definitions[req.query.target.name + ".attachments"];
    if (attachments) {
      const diffData = await req.diff();
      let deletedAttachments = [];
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

  async onCreate(data, credentials, token, attachments, req, parentId) {
    let failedReq = [],
      Ids = [],
      success = [],
      success_ids = [];
    await Promise.all(
      data.map(async (d) => {
        if(d.HasActiveEntity ==1 ){
          console.log("Content in edit"+JSON.stringify(d.content));
          if( d.isContentUpdated == 1){
          //call setContentStream
          const setContentResponse = await setContentStream(
            d,
            this.creds,
            token
          );
          }
        }else{
        // Check if d.content is null
        if (d.content === null) {
          failedReq.push(emptyFileErr(d.filename));
          Ids.push(d.ID);
        } else {
          console.log("Content "+JSON.stringify(d.content));
          const response = await createAttachment(
            d,
            credentials,
            token,
            attachments,
            parentId
          );
          if (response.status == 201) {
            d.folderId = parentId;
            d.url = response.data.succinctProperties["cmis:objectId"];
            d.content = null;
            success_ids.push(d.ID);
            success.push(d);
          } else {
            Ids.push(d.ID);
            failedReq.push(response.response.data.message);
          }
        }
      }
      })
    );

    let removeCondition = (obj) => Ids.includes(obj.ID);
    req.data.attachments = req.data.attachments.filter(
      (obj) => !removeCondition(obj)
    );
    let removeSuccessAttachments = (obj) => success_ids.includes(obj.ID);

    // Filter out successful attachments
    req.data.attachments = req.data.attachments.filter(
      (obj) => !removeSuccessAttachments(obj)
    );

    // Add successful attachments to the end of the attachments array
    req.data.attachments = [...req.data.attachments, ...success];
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
  async updateContentHandler(req) {
         //check if repository is versionable
        const isVersioned =  await isRepositoryVersioned( this.creds);
        // if(!isVersioned){
        //   //remove the data from drafts
        //   const res = await DELETE.from(req.target).where({ ID: req.data.ID});
        //   //fire a select query
        // }else{
        if(req.data){
          const sel = await SELECT.from(req.target).where({ ID: { '=': [req.data.ID] }});
      if(sel.length>0 ){
        if( sel[0].HasActiveEntity == 1){
          //if already existing in attachments table
      req.data.filename = sel[0].filename;
      req.data.isContentUpdated = 1;

  }
  req.data.DraftAdministrativeData_DraftUUID = sel[0].DraftAdministrativeData_DraftUUID;
  const test = await UPSERT.into(req.target)
  .entries(req.data);
//}
}
}
  }
  async readEntity(req) {
console.log(JSON.stringify(req.data)+":"+JSON.stringify(req));
  }
  async registerUpdateHandlers(srv, entity,target) {

    srv.before(
      ["DELETE", "UPDATE"],
      entity,
      this.attachDeletionData.bind(this)
    );
    srv.before("SAVE", entity, this.draftSaveHandler.bind(this));
    srv.after(
      ["DELETE", "UPDATE"],
      entity,
      this.deleteAttachmentsWithKeys.bind(this)
    );
    srv.prepend(() => {
      if (target.drafts) {
        srv.on(
          "PUT",
          target.drafts,
          this.updateContentHandler.bind(this)
        );
      }
    });
        // srv.before(
        //   "DELETE",
        //   target.drafts,
        //   this.readEntity.bind(this)
        // );

    return;
  }
};
