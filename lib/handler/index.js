const { getConfigurations,fetchAccessToken } = require("../util");
const axios = require("axios").default;
const FormData = require("form-data");
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');

async function createAttachment(data,credentials,token) {
  console.log("data "+JSON.stringify(data))
  createDocument(data, token,credentials.uri);
  console.log("Creating attachment ");
}

function deleteAttachment() {
  getSDMCredentials();
}

async function createDocument(data, token,uri) {
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

  try {
    const response = await axios.post(documentCreateURL, formData,config);
    console.log("Reponse axiosdcwv ");
    console.log("Reponse axios "+response.data);
  } catch (error) {
    console.error(error);
  }

  axios
    .post(documentCreateURL, formData, config)
    .then((response) => {
      console.log("In Response "+JSON.stringify(response));
      console.log("Res objectId" + response.data.succinctProperties["cmis:objectId"]);
      return response.data.succinctProperties["cmis:objectId"];
    })
    .catch((error) => {
      console.log("In Eroor")
      console.error("Error " + error);
    });
}

module.exports = {
  createAttachment,
  deleteAttachment,
};
