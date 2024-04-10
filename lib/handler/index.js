const { getConfigurations,fetchAccessToken } = require("../util");
const axios = require("axios").default;
const FormData = require("form-data");

async function createAttachment(data,credentials) {
  const token = await fetchAccessToken(credentials);
  console.log("Token "+token)
  const objectId = createDocument(data, token,credentials.uri);
  console.log("Creating attachment");
}

function deleteAttachment() {
  getSDMCredentials();
}

function createDocument(data, token,uri) {
  const { repositoryId } = getConfigurations();
  console.log("Repo "+repositoryId+":"+JSON.stringify(data));
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
  console.log("Token "+JSON.stringify(headers.Authorization));
  axios
    .post(documentCreateURL, formData, config)
    .then((response) => {
      console.log("Res " + response.data.succinctProperties["cmis:objectId"]);
      return response.data.succinctProperties["cmis:objectId"];
    })
    .catch((error) => {
      console.error("Error " + error);
    });
}

module.exports = {
  createAttachment,
  deleteAttachment,
};
