const cds = require("@sap/cds/lib");
const { createAttachment, deleteAttachment, readAttachment } = require("../lib/handler");
const { fetchAccessToken } = require("./util/index");
const {
  getDraftAttachments,
  getDuplicateAttachments,
  getURLsToDeleteFromAttachments,
  getURLFromAttachments
} = require("../lib/persistence");
const { duplicateFileErr } = require("./util/messageConsts");
const { fileNotFoundErr } = require("./util/messageConsts");

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

  async get(attachments, keys) {
    const response = await getURLFromAttachments(keys, attachments);
    const token = await fetchAccessToken(this.creds);
    try {
      if (response?.url) {
        const Key = response.url;
        const content = await readAttachment(Key, token, this.creds);
        return content;
      }
    } catch (error) {
      throw new Error(fileNotFoundErr());
    }
  }

  async draftSaveHandler(req) {
    const attachments =
      cds.model.definitions[req.query.target.name + ".attachments"];
    const attachment_val = await getDraftAttachments(attachments, req);
    if (attachment_val.length > 0) {
      //verify if duplicates exist for the drafts
      const duplicateFilesErrMsg = await this.isFileNameDuplicate(
        attachment_val,
        attachments
      );
      if (duplicateFilesErrMsg != "") {
        req.reject(409, duplicateFileErr(duplicateFilesErrMsg));
      }
      const token = await fetchAccessToken(this.creds);
      const failedReq = await this.onCreate(
        attachment_val,
        this.creds,
        token,
        attachments,
        req
      );
      let errorResponse = "";
      failedReq.forEach((attachment) => {
        attachment = attachment.replace("Child", "");
        errorResponse = errorResponse + "\n" + attachment;
      });
      if (errorResponse != "") req.info(200, errorResponse);
    }
  }

  async isFileNameDuplicate(attachment_val, attachments) {
    let fileNames = [];
    for (let index in attachment_val) {
      fileNames.push(attachment_val[index].filename);
    }
    const are_duplicates = await getDuplicateAttachments(
      fileNames,
      attachments
    );
    let duplicateFilesErrMsg = "";
    are_duplicates.forEach((file) => {
      duplicateFilesErrMsg += "," + file.filename;
    });
    // Remove leading comma if any
    if (duplicateFilesErrMsg.charAt(0) === ",") {
      duplicateFilesErrMsg = duplicateFilesErrMsg.slice(1);
    }
    return duplicateFilesErrMsg;
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
    }
  }

  async deleteAttachmentsWithKeys(records, req) {
    let failedReq = [],
      Ids = [];
    const attachments =
      cds.model.definitions[req.query.target.name + ".attachments"];

    if (req?.attachmentsToDelete?.length > 0) {
      const token = await fetchAccessToken(this.creds);
      const deletePromises = req.attachmentsToDelete.map(async (attachment) => {
        const deleteAttachmentResponse = await deleteAttachment(
          this.creds,
          token,
          attachment.url,
          attachments
        );
        const delData = await this.handleRequest(
          deleteAttachmentResponse,
          attachment.url
        );
        if (delData && Object.keys(delData).length > 0) {
          failedReq.push(delData.message);
          Ids.push(delData.ID);
        }
      });
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
  }

  async onCreate(data, credentials, token, attachments, req) {
    let failedReq = [],
      Ids = [],
      success = [],
      success_ids = [];
    var i = 0;
    await Promise.all(
      data.map(async (d) => {
        const response = await createAttachment(
          d,
          credentials,
          token,
          attachments
        );
        if (response.status == 201) {
          d.url = response.data.succinctProperties["cmis:objectId"];
          d.content = null;
          success_ids.push(d.ID);
          success.push(d);
        } else {
          Ids.push(d.ID);
          failedReq.push(response.response.data.message);
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
        break;
    }
  }

  registerUpdateHandlers(srv, entity, target) {
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
    return;
  }
};
