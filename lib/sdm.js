const cds = require("@sap/cds/lib");

const { createAttachment, deleteAttachment, readAttachment} = require("../lib/handler");
const { SELECT } = cds.ql;
const {fetchAccessToken } = require("../lib/util");
const axios = require("axios").default;
const FormData = require("form-data");
const { del } = require("request");

module.exports = class SDMAttachmentsService extends require("@cap-js/attachments/lib/basic") {
  init() {
    this. creds = this.options.credentials;
    return super.init();
  }
  getSDMCredentials(){
    return this.creds;
  }

  async get(attachments, keys) {
    const response = await SELECT.from(attachments, keys).columns("url");
    const token = await fetchAccessToken(this.creds);
    try {
      if (response?.url) {
        const Key = response.url;
        const content = await readAttachment(Key, token, this.creds)
        return content;
      }
      throw new Error("Url not found");
    } catch (error) {
      console.error(error);
      throw new Error(error);
    }
  }

  async getDbRecord(attachments, keys) {
    return await SELECT.from(attachments, keys).columns('url');
  }


  async draftSaveHandler(req) {

  const attachments = cds.model.definitions[req.query.target.name + ".attachments"];
  const queryFields = this.getFields(attachments);
  const attachment_val = await SELECT (queryFields) .from(attachments.drafts).where({up__id:req.data.id }).and({HasActiveEntity:{'<>':1}});
   if(attachment_val.length >0){
   //verify if duplicates exist for the drafts
   const duplicateFilesErrMsg= await this.isFileNameDuplicate(attachment_val,attachments);
   if(duplicateFilesErrMsg !=""){
    req.reject(409,"The files "+duplicateFilesErrMsg+" are already present in the repository. Kindly remove them from drafts,rename and try again.")
   }
   const token = await fetchAccessToken(this.creds);
   console.log(token)
   const failedReq=  await this.onCreate(attachment_val,this.creds,token,attachments,req);
      let errorResponse="";
      failedReq.forEach((attachment) => {
        errorResponse = errorResponse+"\n"+attachment.errorMessage;
      });
      if(errorResponse !="")
     req.reject(400,errorResponse);
    }
  }

 async isFileNameDuplicate(attachment_val,attachments){
  let fileNames = [];
   for(let index in attachment_val){
    fileNames.push(attachment_val[index].filename);
 }
   const are_duplicates = await SELECT.distinct(['filename']) .from(attachments).where({filename:{in:fileNames} });
   let duplicateFilesErrMsg="";
   are_duplicates.forEach((file) => {
    duplicateFilesErrMsg += "," + file.filename;
});
// Remove leading comma if any
if (duplicateFilesErrMsg.charAt(0) === ',') {
    duplicateFilesErrMsg = duplicateFilesErrMsg.slice(1);
}
return duplicateFilesErrMsg;

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
    const attachments = cds.model.definitions[req.query.target.name + ".attachments"];
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
      if (attachmentsToDelete.length > 0) {
        req.attachmentsToDelete = attachmentsToDelete;
      }
    }
}
  async  deleteAttachmentsWithKeys(records, req) {
    const token =  await fetchAccessToken(this.creds);
  const attachments = cds.model.definitions[req.query.target.name + ".attachments"];

  if (req?.attachmentsToDelete?.length>0) {
    const deletePromises = req.attachmentsToDelete.map(async (attachment) => {
      const deleteAttachmentResponse = await deleteAttachment(this.creds,token,attachment.url,attachments);
      if(deleteAttachmentResponse.status !=201){
        req.error(deleteAttachmentResponse.status,deleteAttachmentResponse.response.data.message)
      }
    });

    // Execute all promises
    await Promise.all(deletePromises);
  }
}

    async onCreate(data,credentials,token,attachments,req) {
      let failedReq=[],objectIds=[],Ids =[];
      var i=0;
      await Promise.all(
        data.map(async (d) => {
           const response =await createAttachment(d,credentials,token,attachments);
           if(response.status ==201){
            d.url = response.data.succinctProperties["cmis:objectId"];
           }
           if(response.status !== 201){
            var newElement = {};
            newElement["ID"] = d.ID;
            newElement["errorMessage"]= response.response.data.message;
            failedReq.push(newElement);

           }
        })
      );
      req.data.attachments =data;
     return failedReq;

     }


   registerUpdateHandlers(srv, entity, target) {
    srv.before(["DELETE", "UPDATE"],entity,this.attachDeletionData.bind(this));
    srv.before("SAVE", entity, this.draftSaveHandler.bind(this));
    srv.after(["DELETE", "UPDATE"],entity,this.deleteAttachmentsWithKeys.bind(this));
    return;
  }

};