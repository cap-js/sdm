const { getConfigurations,fetchAccessToken } = require("../util");
const axios = require("axios").default;
const FormData = require("form-data");
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const request = require('request');

async function createAttachment(data,credentials,token,attachments) {
  console.log("data "+JSON.stringify(data))
createDocument(data, token,credentials.uri,attachments);
}

function deleteAttachment() {
  getSDMCredentials();
}

 async function createDocument(data, token,uri,attachments) {
  const { repositoryId } = getConfigurations();
  const documentCreateURL = uri+ "browser/" + repositoryId + "/root";
  console.log("doc url "+documentCreateURL);
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
 //const objectId  =  buildHttpRequest(documentCreateURL,formData,config,attachments,data.ID);
  // try {
  //   const response = await axios.post(documentCreateURL, formData, config);
  //   console.log("Res objectId" + response.data.succinctProperties["cmis:objectId"]);
  //    const result =updateObjectForAttachments(attachments,ID,response.data.succinctProperties["cmis:objectId"]);
  //   } catch (error) {
  //    console.error(error);
  //      }
  var options = {
    url: documentCreateURL,
    method: 'POST', // Don't forget this line
    headers: headers,
    form: formData
};

 //console.log(" objectId: "+objectId);

  try {
    const response = await axios.post(documentCreateURL, formData,config);
    console.log("Reponse axiosdcwv ");
    objectId = response.data.succinctProperties["cmis:objectId"];
  } catch (error) {
    console.error(error);
  }


}
async function buildHttpRequest(documentCreateURL,formData,config,attachments,ID){
//  await axios
//     .post(documentCreateURL, formData, config)
//     .then((response) => {
//       console.log("Res objectId" + response.data.succinctProperties["cmis:objectId"]);
//        const result =updateObjectForAttachments(attachments,ID,response.data.succinctProperties["cmis:objectId"]);
//     })
//     .catch((error) => {
//       console.error("Error while creating" + error);
//     });
    // try {
    //   const response = await axios.post(documentCreateURL, formData, config);
    //   console.log("Res objectId" + response.data.succinctProperties["cmis:objectId"]);
    //    const result =updateObjectForAttachments(attachments,ID,response.data.succinctProperties["cmis:objectId"]);
    // } catch (error) {
    //   console.error("Error while creating " + error);
    // }

    const getData = async () => {
	const response = await axios.get(
		`https://famous-quotes4.p.rapidapi.com/random`
	);
};
}
async function updateObjectForAttachments(attachments,ID,objectId){
   //upsert to attachments table with url
         await UPDATE.entity(attachments)
            .set({url: {'=': objectId}})
            .where({ID:{'=': ID}});
}

module.exports = {
  createAttachment,
  deleteAttachment,
};
