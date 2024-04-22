const { getConfigurations } = require("../util");
const axios = require("axios").default;
const FormData = require("form-data");

 async function createAttachment(data,credentials,token,attachments) {
  const { repositoryId } = getConfigurations();
  const documentCreateURL = credentials.uri+ "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "createDocument");
  formData.append("propertyId[0]", "cmis:name");
  formData.append("propertyValue[0]", data.filename);
  formData.append("propertyId[1]", "cmis:objectTypeId");
  formData.append("propertyValue[1]", "cmis:document");
  formData.append("succinct", "true");
  formData.append("filename", data.content, {
      name: "file",
      filename: data.filename,
     });

  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;
  const config = {
    headers: headers,
  };
  const response = await updateServerRequest(documentCreateURL,formData,config,attachments,data.ID);
 //const response= await buildHttpRequest(documentCreateURL,formData,config,attachments,data.ID);
  return response;
 }

async function buildHttpRequest(documentCreateURL,formData,config,attachments,ID){
  await axios
  .post(documentCreateURL, formData, config)
  .then(async (response) => {
    console.log("Res objectId" + response.data.succinctProperties["cmis:objectId"]);
    const result = await updateObjectForAttachments(attachments,ID,response.data.succinctProperties["cmis:objectId"]);
    return result;
  })
  .catch((error) => {
    console.error("Error while creating" + error);
  });
  // try {
  //   const response = await axios.post(documentCreateURL, formData, config);
  //   console.log("Res objectId" + response.data.succinctProperties["cmis:objectId"]);
  //   const result =updateObjectForAttachments(attachments,ID,response.data.succinctProperties["cmis:objectId"]);
  // } catch (error) {
  //   console.error("Error while creating " + error);
  // }
}
async function deleteAttachment(credentials,token,objectId,attachments) {
  const { repositoryId } = getConfigurations();
  const documentDeleteURL = credentials.uri+ "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "delete");
  formData.append("objectId", objectId);
  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;
  const config = {
    headers: headers,
  };
  const response = await updateServerRequest(documentDeleteURL,formData,config);
  if(response.status == 404){
   const deleteAttachmentRes = await deleteAttachmentFromUI(attachments,objectId);
  }
  return response;
}

const updateServerRequest = async (documentCreateURL,formData,config,attachments,ID, callback) => {
  try{
 const result = await axios.post(documentCreateURL, formData,config)
//  if(result.status ==201){
//   const objectId= result.data.succinctProperties["cmis:objectId"];
//   const res = await updateObjectForAttachments(attachments,ID,objectId);
// }
 return result;
  }catch(Error){
    return Error;
  }
};
async function deleteAttachmentFromUI(attachments,objectId){
  await DELETE.from(attachments).where({url:objectId});
}
async function updateObjectForAttachments(attachments,ID,objectId){
   //upsert to attachments table with url
       const res =   await UPDATE.entity(attachments)
            .set({url: objectId})
            .where({ID:ID});
            console.log(res)
}


module.exports = {
  createAttachment,
  deleteAttachment
};
