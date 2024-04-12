const cds = require("@sap/cds/lib");
const { createAttachment } = require("../lib/handler");
const { SELECT } = cds.ql;
const {fetchAccessToken } = require("../lib/util");

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
    if (response?.url) {
      const Key = response.url;

      const content = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key,
        })
      );
      return content.Body;
    }
  }

   async draftSaveHandler(req) {
    console.log("on save...");

    const attachments = cds.model.definitions[req.query.target.name + ".attachments"];
   //select the attachments which exist in drafts and not in attachments and send them to onCreate
   const attachment_val = await SELECT ("filename", "mimeType", "content", "url", "ID") .from(attachments).where({up__id:req.data.id});
   console.log("Attachment values "+JSON.stringify(attachment_val));
   console.log("====================");
   const attachments_drafts = await SELECT ("filename", "mimeType", "content", "url", "ID") .from(attachments.drafts).where({ID:{'not in':attachment_val}}).and({up__id:req.data.id})
   console.log("Attachment drafts "+JSON.stringify(attachments_drafts));
   console.log("**********");
   const token = await fetchAccessToken(this.creds);
       this.onCreate(attachments_drafts,this.creds,token);
  //  };

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

   async onCreate(data,credentials,token) {
   Promise.all(
      data.map((d) => {
         createAttachment(d,credentials,token);
      })
    );
    // for (let i = 0; i < data.length; i++) {

    //  // console.log("object Id in onCreate"+JSON.stringify(objectId));
    //   //update the url with the object id to attachment table
    // }
  }
  onDelete(objectId) {}

   registerUpdateHandlers(srv, entity, target) {
    srv.before(["DELETE", "UPDATE"],entity,this.attachDeletionData.bind(this));
    console.log("Target"+target)
    srv.prepend(() => {
        srv.on(
          "SAVE",
          entity, this.draftSaveHandler.bind(this)
        );
    });
   //srv.after("SAVE", entity, this.draftSaveHandler(target));
   srv.after(["DELETE", "UPDATE"],entity,this.deleteAttachmentsWithKeys.bind(this));
    return;
  }


};