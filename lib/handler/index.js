const { getConfigurations, extractSecondaryTypeIds, checkMCM, prepareSecondaryProperties } = require("../util");
const axios = require("axios").default;
const FormData = require("form-data");
const { errorMessage, updateAttachmentError, unsupportedProperties } = require("../util/messageConsts");
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 3600 });



async function readAttachment(Key, token, credentials) {
   const { repositoryId } = getConfigurations();
  const documentReadURL =
    credentials.uri +
    "browser/" +
    repositoryId +
    "/root?objectID=" +
    Key +
    "&cmisselector=content";
  const config = {
    headers: { Authorization: `Bearer ${token}` },
    responseType: "stream",
  };
  try {
    const response = await getServerRequest(
      documentReadURL,
      config
    );
    return response;
  } catch (error) {
    if (error.message === "Request failed with status code 404") {
      const err = new Error("Attachment not found in the repository");
      err.code = 404;
      err.status = 404;
      throw err;
    }
    throw error;
  }
}



async function getRepositoryInfo(req, credentials, token) {
  const { repositoryId } = getConfigurations();
  const getRepoInfoUrl =
    credentials.uri +
    "browser/" +
    repositoryId +
    "?cmisselector=repositoryInfo";
  const config = {
    headers: { Authorization: `Bearer ${token}` },
  };
  try {
    const response = await axios.get(getRepoInfoUrl, config);
    return response;
  } catch (error) {
    if (error.response?.status === 404) {
      req.reject(404, "Failed to get repository info");
    }
    else if (error.response?.status === 500) {
      req.reject(500, error.response.data?.message);
    }
    throw new Error(error);
  }
}

async function getFolderIdByPath(req, credentials, token, attachments, upId) {
  const up_ = attachments.keys.up_.keys[0].$generatedFieldName;
  const { repositoryId } = getConfigurations();
  const entityId = req.data[up_] || upId;
  const getFolderByPathURL =
    credentials.uri +
    "browser/" +
    repositoryId +
    "/root/" +
    entityId +
    "?cmisselector=object";
  const config = {
    headers: { Authorization: `Bearer ${token}` },
  };
  try {
    const response = await axios.get(getFolderByPathURL, config);
    return response.data.properties["cmis:objectId"].value;
  } catch (error) {
    let statusText = errorMessage;
    if (error.response?.statusText) {
      statusText = error.response.statusText;
    }
    console.log(statusText);
    return null;
  }
}

async function getFolderIdByIDAsPath(req, credentials, token, attachments) {
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
    let statusText = errorMessage;
    if (error.response?.statusText) {
      statusText = error.response.statusText;
    }
    console.log(statusText);
    return null;
  }
}

async function createFolder(req, credentials, token, attachments, customFolderName) {
  const upID = attachments.keys.up_.keys[0].$generatedFieldName;
  const { repositoryId } = getConfigurations();
  const folderCreateURL = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "createFolder");
  formData.append("propertyId[0]", "cmis:name");
  // Use customFolderName if provided, otherwise fall back to req.data[upID]
  const folderName = req.data[upID] || customFolderName;
  formData.append("propertyValue[0]", folderName);
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
  if (data.mimeType?.toLowerCase() === "application/internet-shortcut") {
    formData.append("propertyId[2]", "cmis:secondaryObjectTypeIds");
    formData.append("propertyValue[2]", "sap:createLink");
    formData.append("propertyId[3]", "sap:linkRepositoryId");
    formData.append("propertyValue[3]", repositoryId);
    formData.append("propertyId[4]", "sap:linkExternalURL");
    formData.append("propertyValue[4]", data.linkUrl);
  } else {
    formData.append("filename", data.content, {
      name: "file",
      filename: data.filename,
    });
  }

  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;
  const config = {
    headers: headers,
  };
  const response = await updateServerRequest(
    documentCreateURL,
    formData,
    config
  );
  return response;
}

async function editLink(objectId, filename, linkUrl, credentials, token) {
  const { repositoryId } = getConfigurations();
  const editLinkURL = `${credentials.uri}browser/${repositoryId}/root`;
  const formData = new FormData();
  const urlShortcut = `[InternetShortcut]\nURL=${linkUrl}`;
  const fileContent = Buffer.from(urlShortcut, 'utf-8');
  const linkFilename = filename ? `${filename}.url` : 'link.url';

  formData.append("cmisaction", "setContent");
  formData.append("objectId", objectId);
  formData.append("filename", linkFilename);
  formData.append("charset", "UTF-8");
  formData.append("succinct", "true");

  formData.append("media", fileContent, {
  filename: linkFilename,
  contentType: "application/internet-shortcut",
  });

  let headers = formData.getHeaders();
  headers["Authorization"] = `Bearer ${token}`;
  const config = {
    headers: headers,
  };
  const response = await updateServerRequest(editLinkURL, formData, config);
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

async function getAttachment(uri, token, objectId) {
  const { repositoryId } = getConfigurations();
  const getAttachmentURL =
    uri
    + "browser/"
    + repositoryId
    + "/root?"
    + "cmisselector=object&objectId="
    + objectId
    + "&succinct=true";

  const config = {
    headers: { Authorization: `Bearer ${token}` },
  };
  try {
    return await axios.get(getAttachmentURL, config);
  } catch (error) {
    let statusText = errorMessage;
    if (error.response?.statusText) {
      statusText = error.response.statusText;
    }
    console.log(statusText);
    return statusText;
  }
}


//Updates an attachment in the SDM repository.
async function updateAttachment(
  req,
  attachment,
  credentials,
  token,
  updatedSecondaryProperties,
  secondaryPropertiesWithInvalidDefinitions
  ) {
  const { repositoryId } = getConfigurations();
  const objectId = attachment.url;

  // Fetch secondary types
  let secondaryTypes;
  try {
    secondaryTypes = await getSecondaryTypes(repositoryId, token, credentials);
  } catch (error) {
    console.log("Error fetching secondary types:", error);
    return 500;
  }

  // Fetch valid secondary properties
  const validSecondaryProperties = await getValidSecondaryProperties(
    req,
    secondaryTypes,
    credentials,
    repositoryId,
    token
  );

  cache.set(repositoryId, secondaryTypes);
  cache.set(`validSecondaryProperties_${repositoryId}`, validSecondaryProperties);

  // Adding the properties which are unsupported to a list so that exeception can be thrown
  const keysToRemove = Object.keys(updatedSecondaryProperties).filter(
    (key) => key !== "cmis:name" && !validSecondaryProperties.includes(key)
  );

  for (const [, value] of Object.entries(secondaryPropertiesWithInvalidDefinitions)) {
    if (Object.hasOwn(updatedSecondaryProperties, value)) {
      keysToRemove.push(value);
    }
  }

  /**
   * Some invalid/unsupported properties were present and were updated.
   * So processing is stopped (Request is not sent to SDM) and exception is thrown
  */
  if (keysToRemove.length > 0) {
    const errorMessage = keysToRemove.join(",");
    throw new Error(`${unsupportedProperties} ${errorMessage}`);
  }

  // Prepare the request URL
  const updateURL = `${credentials.uri}browser/${repositoryId}/root?objectId=${objectId}`;

  // Prepare the request body
  const formData = new FormData();
  formData.append("cmisaction", "update");
  formData.append("propertyId[0]", "cmis:secondaryObjectTypeIds");

  // Add secondary types to the request body
  secondaryTypes.forEach((type, index) => {
    formData.append(`propertyValue[0][${index}]`, type);
  });

  // Add secondary properties to the request body
  prepareSecondaryProperties(formData, updatedSecondaryProperties);

  // Add headers
  let headers = formData.getHeaders();
  headers["Authorization"] = "Bearer " + token;

  // Send the request
  const config = {
    headers: headers,
  };

  try {
    const response = await updateServerRequest(updateURL, formData, config);
    if (response?.response?.status === 400) {
      const jsonResponse = await response.response.json();
      const message = jsonResponse.message;
      throw new Error(message);
    }
    return response.status; // Return the HTTP status code
  } catch (error) {
    throw new Error(updateAttachmentError, error);
  }
}

//Fetches secondary types from the SDM repository with caching.
async function getSecondaryTypes(repositoryId, token, credentials) {
  const cacheKey = repositoryId;
  let secondaryTypes = cache.get(cacheKey);

  if (!secondaryTypes) {
    const sdmUrl = `${credentials.uri}browser/${repositoryId}?cmisselector=typeDescendants`;

    // Prepare headers
    const headers = {
      Authorization: `Bearer ${token}`,
    };

    try {
      // Send the GET request using axios
      const response = await axios.get(sdmUrl, { headers });

      const jsonArray = response.data;
      const result = [];

      // Extract secondary types
      let secondaryTypesJSON = [];
      for (const jsonObject of jsonArray) {
        if (jsonObject.type.id === "cmis:secondary") {
          secondaryTypesJSON = jsonObject.children || [];
          break; // Exit the loop once the correct type is found
        }
      }

      // Extract secondary type IDs
      extractSecondaryTypeIds(secondaryTypesJSON, result);
      return result;
    } catch (error) {
      throw new Error('Could not update the attachment', error);
    }
  }

  return secondaryTypes;
}

//Fetches valid secondary properties from the SDM repository with caching.
async function getValidSecondaryProperties(req, secondaryTypes, sdmCredentials, repositoryId, jwtToken) {
  const cacheKey = `validSecondaryProperties_${repositoryId}`;
  let validSecondaryProperties = cache.get(cacheKey);

  if (!validSecondaryProperties) {
    validSecondaryProperties = [];

    for (let i = secondaryTypes.length - 1; i >= 0; i--) {
      const typeId = secondaryTypes[i];
      const sdmUrl = `${sdmCredentials.uri}browser/${repositoryId}?cmisselector=typeDefinition&typeID=${typeId}`;

      // Prepare headers
      const headers = {
        Authorization: `Bearer ${jwtToken}`,
      };

      try {
        // Send the GET request using axios
        const response = await axios.get(sdmUrl, { headers });

        const responseBody = JSON.stringify(response.data);
        const isValid = checkMCM(responseBody, validSecondaryProperties);

        // Remove invalid types
        if (!isValid) {
          secondaryTypes.splice(i, 1); // No need to adjust the index
        }
      } catch (error) {
        const reasonPhrase = error.response ? error.response.statusText : 'Unknown error';
        req.reject(updateAttachmentError + ": " + reasonPhrase);
      }
    }
  }

  return validSecondaryProperties;
}

const updateServerRequest = async (url, formData, config) => {
  try {
    const result = await axios.post(url, formData, config);
    return result;
  } catch (error) {
    return error;
  }
};

const getServerRequest = async (url, config) => {
  return await axios.get(url, config);
};


module.exports = {
  getRepositoryInfo,
  getFolderIdByPath,
  getFolderIdByIDAsPath,
  createFolder,
  createAttachment,
  editLink,
  deleteAttachmentsOfFolder,
  deleteFolderWithAttachments,
  getAttachment,
  readAttachment,
  updateAttachment
};
