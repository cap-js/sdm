const { getConfigurations } = require("../util");
const axios = require("axios").default;
const FormData = require("form-data");

async function readAttachment(Key, token, credentials) {
  try {
    const document = await readDocument(Key, token, credentials.uri);
    return document;
  } catch (error) {
    throw new Error(error);
  }
}

async function readDocument(Key, token, uri) {
  const { repositoryId } = getConfigurations();
  const documentReadURL =
    uri +
    "browser/" +
    repositoryId +
    "/root?objectID=" +
    Key +
    "&cmisselector=content";
  const config = {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "arraybuffer",
  };

  try {
    const response = await axios.get(documentReadURL, config);
    const responseBuffer = Buffer.from(response.data, "binary");
    return responseBuffer;
  } catch (error) {
    let statusText = "An Error Occurred";
    if (error.response && error.response.statusText) {
      statusText = error.response.statusText;
    }

    throw new Error(statusText);
  }
}

async function getFolderIdByPath(req, credentials, token, attachments) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  const { repositoryId } = getConfigurations();
  const getFolderByPathURL =
    credentials.uri +
    "browser/" +
    repositoryId +
    "/root/" +
    req.data[idValue] +
    "?cmisselector=object";
  const config = {
    headers: { Authorization: `Bearer ${token}` },
  };
  try {
    const response = await axios.get(getFolderByPathURL, config);
    return response.data.properties["cmis:objectId"].value;
  } catch (error) {
    let statusText = "An Error Occurred";
    if (error.response && error.response.statusText) {
      statusText = error.response.statusText;
    }
    console.log(statusText);
    return null;
  }
}

async function createFolder(req, credentials, token, attachments) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const idValue = up_.split("__")[1];
  const { repositoryId } = getConfigurations();
  const folderCreateURL = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "createFolder");
  formData.append("propertyId[0]", "cmis:name");
  formData.append("propertyValue[0]", req.data[idValue]);
  formData.append("propertyId[1]", "cmis:objectTypeId");
  formData.append("propertyValue[1]", "cmis:folder");
  formData.append("succinct", "true");

  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;
  const config = {
    headers: headers,
  };
  return await updateServerRequest(folderCreateURL, formData, config);
}

async function createAttachment(
  data,
  credentials,
  token,
  attachments,
  parentId
) {
  const { repositoryId } = getConfigurations();
  const documentCreateURL =
    credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "createDocument");
  formData.append("objectId", parentId);
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
  const response = await updateServerRequest(
    documentCreateURL,
    formData,
    config,
    attachments,
    data.ID
  );
  return response;
}

async function deleteAttachmentsOfFolder(credentials, token, objectId) {
  const { repositoryId } = getConfigurations();
  const documentDeleteURL =
    credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "delete");
  formData.append("objectId", objectId);
  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;
  const config = {
    headers: headers,
  };
  const response = await updateServerRequest(
    documentDeleteURL,
    formData,
    config
  );
  return response;
}

async function deleteFolderWithAttachments(credentials, token, parentId) {
  const { repositoryId } = getConfigurations();
  const folderDeleteURL = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "deleteTree");
  formData.append("objectId", parentId);
  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;
  const config = {
    headers: headers,
  };
  const response = await updateServerRequest(folderDeleteURL, formData, config);
  return response;
}

async function renameAttachment(
  modifiedAttachment,
  credentials,
  token,
) {
  const { repositoryId } = getConfigurations();
  const documentRenameURL =
    credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "update");
  formData.append("propertyId[0]", "cmis:name");
  formData.append("propertyValue[0]", modifiedAttachment.name);
  formData.append("objectId", modifiedAttachment.url);
  
  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;
  const config = {
    headers: headers,
  };
  const response = await updateServerRequest(
    documentRenameURL,
    formData,
    config
  );
  return response;
}

const updateServerRequest = async (url, formData, config) => {
  try {
    const result = await axios.post(url, formData, config);
    return result;
  } catch (Error) {
    return Error;
  }
};


module.exports = {
  getFolderIdByPath,
  createFolder,
  createAttachment,
  deleteAttachmentsOfFolder,
  deleteFolderWithAttachments,
  readAttachment,
  renameAttachment
};
