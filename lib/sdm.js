const cds = require("@sap/cds/lib");
const { createAttachment,readAttachment } = require("../lib/handler");
const { SELECT } = cds.ql;
const {fetchAccessToken } = require("../lib/util");
const axios = require("axios").default;
const FormData = require("form-data");

module.exports = class SDMAttachmentsService extends require("@cap-js/attachments/lib/basic") {
  init() {
    this. creds = this.options.credentials;
    console.log("Cred "+ JSON.stringify(this. creds));
    return super.init();
  }
  getSDMCredentials(){
    return this.creds;
  }

  async get(attachments, keys) {
    const response = await SELECT.from(attachments, keys).columns("url");
    const token = await fetchAccessToken(this.creds);
    if (response?.url) {
      const Key = response.url;
      const content = await readAttachment(Key,token,this.creds)
      console.log(content)
      return content;
    }
  }

    async draftSaveHandler(req) {
  //   console.log("on save...");

    const attachments = cds.model.definitions[req.query.target.name + ".attachments"];
    const queryFields = this.getFields(attachments);
   //select the attachments which exist in drafts and not in attachments and send them to onCreate
   const attachment_val = await SELECT (queryFields) .from(attachments).where({up__ID:req.data.ID});
   console.log("Attachment values "+JSON.stringify(attachment_val));
   console.log("====================");
   const attachments_drafts = await SELECT (queryFields) .from(attachments.drafts).where({ID:{'not in':attachment_val}}).and({up__ID:req.data.ID})
   console.log("Attachment drafts "+JSON.stringify(attachments_drafts));
   console.log("**********");
   const token = await fetchAccessToken(this.creds);

   const failedReq = await this.onCreate(attachments_drafts,this.creds,token,attachments,req);
   let IDs = failedReq.map(element => element.ID);
   const delRes = await DELETE.from(attachments).where({ID: { in: IDs}});
   console.log(delRes);
   let errorResponse = failedReq.map(element => ({ "message": element.errorMessage }));
   req.info(200,errorResponse);




  // console.log("on save...");
  // console.log("Att "+attachments)
  // return async (_, req) => {
  //   const draftAttachments = await SELECT ("filename", "mimeType", "content", "url", "ID")
  //   .from(attachments.drafts).where({up__id:req.data.id})
  //     "and",
  //     { ref: ["content"] },
  //     "is not null";
  //   console.log("draftAttachments value "+JSON.stringify(draftAttachments));
  //   const token = await fetchAccessToken(this.creds);
  //    this.onCreate(draftAttachments,this.creds,token,attachments);
  //  };

  }
  getFields(attachments) {
    const attachmentFields = ["filename", "mimeType", "content", "url", "ID"];
    const { up_ } = attachments.keys;
    if (up_)
      return up_.keys
        .map((k) => "up__" + k.ref[0])
        .concat(...attachmentFields)
        .map((k) => ({ ref: [k] }));
    else return Object.keys(attachments.keys);
  }
  async put(attachments, data, _content) {
    if (!Array.isArray(data)) {
      if (_content) data.content = _content;
      data = [data];
    }
    return Promise.all(
      data.map((d) => {
        return UPSERT(d).into(attachments);
      })
    );
  }
  async attachDeletionData(req) {
    console.log("Befole delete ...");
    const attachments = cds.model.definitions[req.query.target.name + ".attachments"];
    console.log("attachments"+attachments);
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
      let attachmentsToDelete = await SELECT.from(attachments)
        .columns("url")
        .where({ ID: { in: [...deletedAttachments] } });
        console.log("attachmentsToDelete"+JSON.stringify(attachmentsToDelete));
      if (attachmentsToDelete.length > 0) {
        req.attachmentsToDelete = attachmentsToDelete;
      }
    }
}
  async deleteAttachmentsWithKeys(records, req) {
   console.log("After update ...");
   if (req?.attachmentsToDelete?.length>0) {
    req.attachmentsToDelete.forEach((attachment) => {
      console.log("Delete vak "+attachment.url);
      this.onDelete(attachment.url);
    });
  }
  }

  async onCreate(data, credentials, token, attachments, res) {
    const ids = data.map(item => item.ID);
    const responses = await Promise.allSettled(
        data.map(d => createAttachment(d, credentials, token, attachments))
    );

    responses.forEach((response, index) => {
      response.id = ids[index]; // Add ID field to the response object
    });
    console.log("this response: ", responses);
    const failedReq = responses
        .filter(result => result.status === "rejected")
        .map(rejected => {
            const ID = rejected.id; // Accessing ID directly from the data object
            const errorMessage = rejected.reason.message; // Extract the error message
            return {
                "ID": ID,
                "errorMessage": errorMessage
            };
        });
    console.log("failedreq: ", failedReq);
    // const oldSend = res.send;
    // res.send = function(data) {
    //     // Formatting the error response
    //     const errorResponse = failedReq.map(element => ({
    //         "message": element.errorMessage
    //     }));
    //     // Send the response with the old send method
    //     oldSend.call(this, errorResponse);
    // }

 // oldSend.call(res, data);

   
       return failedReq;    
   }
  onDelete(objectId) {}

   registerUpdateHandlers(srv, entity, target) {
    srv.before(["DELETE", "UPDATE"],entity,this.attachDeletionData.bind(this));
    console.log("Target"+target)
//    srv.prepend(() => {
//        srv.on(
//          "SAVE",
//          entity, this.draftSaveHandler.bind(this)
//        );
//    });
    srv.before("SAVE", entity, this.draftSaveHandler.bind(this));
   //srv.after(["DELETE", "UPDATE"],entity,this.deleteAttachmentsWithKeys.bind(this));
    return;
  }


};