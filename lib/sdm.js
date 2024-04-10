const cds = require("@sap/cds/lib");
const { createAttachment } = require("../lib/handler");
const { SELECT } = cds.ql;

module.exports = class SDMAttachmentsService extends require("./basic") {
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

   draftSaveHandler(attachments) {
    console.log("on save...");
    console.log("Att "+attachments)
    return async (_, req) => {
      const draftAttachments = await SELECT ("filename", "mimeType", "content", "url", "ID")
      .from(attachments.drafts).where({up__id:req.data.id})
        "and",
        { ref: ["content"] },
        "is not null and" , { ref: ["url"] },  "is  null";
      console.log("draftAttachments value "+JSON.stringify(draftAttachments));
       this.onCreate(draftAttachments,this.creds);
    };

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

  async onCreate(data,credentials) {
    for (let i = 0; i < data.length; i++) {
      const objectId = createAttachment(data[i],credentials);
      console.log("object Id "+JSON.stringify(objectId));
      //update the url with the object id to attachment table
    }
  }
  onDelete(objectId) {}

  async registerUpdateHandlers(srv, entity, target) {
    srv.before(["DELETE", "UPDATE"],entity,this.attachDeletionData.bind(this));
    console.log("Target"+target)
   srv.after("SAVE", entity, this.draftSaveHandler(target));
   srv.after(["DELETE", "UPDATE"],entity,this.deleteAttachmentsWithKeys.bind(this));
    return;
  }


};