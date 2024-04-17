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
      this.onCreate(attachments_drafts,this.creds,token,attachments);



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

   async onCreate(data,credentials,token,attachments) {
  for (let i = 0; i < data.length; i++) {
         const objectId = createAttachment(data[i],credentials,token,attachments);
         console.log("Object Id after create "+objectId);
     }


    //  // console.log("object Id in onCreate"+JSON.stringify(objectId));
    //   //update the url with the object id to attachment table
    // }
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