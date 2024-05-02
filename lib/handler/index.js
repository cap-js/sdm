const { read } = require("@sap/cds/lib");
const { getConfigurations } = require("../util");
const axios = require("axios").default;
const FormData = require("form-data");

async function readAttachment(Key,token,credentials) {
  try {
    const document = await readDocument(Key,token,credentials.uri)
    console.log(document,"doc")
    return document
  } catch (error) {
    console.error(error);
    throw new Error(error);
  }
}

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
  return response;
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
  return response;
}

async function readDocument(Key, token, uri){
  const { repositoryId } = getConfigurations();
  const documentReadURL = uri+ "browser/" + repositoryId + "/root?objectID=" + Key + "&cmisselector=content"; 
  console.log('Check url: ', documentReadURL);
  const config = {
    headers: {Authorization: `Bearer ${token}`},
    responseType: 'arraybuffer'
  };

  try {
    const response = await axios.get(documentReadURL, config);
    const responseBuffer = Buffer.from(response.data, 'binary');
    return responseBuffer;
  } catch (error) {
    console.error(error);
    let statusText = "An Error Occurred"; // default to "An Error Occurred"
    if (error.response && error.response.statusText) {
      statusText = error.response.statusText;
    }

    throw new Error(statusText);
  }
}

const updateServerRequest = async (documentCreateURL,formData,config,attachments,ID, callback) => {
  try{
 const result = await axios.post(documentCreateURL, formData,config)
 return result;
  }catch(Error){
    return Error;
  }
};



module.exports = {
  createAttachment,
  deleteAttachment,
  readAttachment,
  readDocument
};
