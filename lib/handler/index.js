const { getConfigurations, extractSecondaryTypeIds, checkMCM, prepareSecondaryProperties } = require("../util");
const FormData = require("form-data");
const { errorMessage, updateAttachmentError, unsupportedProperties } = require("../util/messageConsts");
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 3600 });
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');


async function readAttachment(Key, destination, credentials) {
  const { repositoryId } = getConfigurations();
  const documentReadURL =
    credentials.uri +
    "browser/" +
    repositoryId +
    "/root?objectID=" +
    Key +
    "&cmisselector=content";
  try {
    const response = await executeHttpRequest(
      destination, {
      method: 'GET',
      url: documentReadURL,
      responseType: "stream"
    }
    );
    return response;
  } catch (error) {
    let statusText = errorMessage;
    if (error.response?.statusText) {
      statusText = error.response.statusText;
    }
    return statusText;
  }
}



async function getRepositoryInfo(req, credentials, destination) {
  const { repositoryId } = getConfigurations();
  const getRepoInfoUrl =
    credentials.uri +
    "browser/" +
    repositoryId +
    "?cmisselector=repositoryInfo";
  try {
    const response = await executeHttpRequest(
      destination, {
      method: 'GET',
      url: getRepoInfoUrl
    }
    );
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

async function getFolderIdByPath(req, credentials, attachments, upId, destination) {
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
  try {
    const response = await executeHttpRequest(
      destination, {
      method: 'GET',
      url: getFolderByPathURL
    }
    );
    return response.data.properties["cmis:objectId"].value;
  } catch {
    return null;
  }
}

async function getFolderIdByIDAsPath(req, credentials, destination, attachments) {
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
  try {
    const response = await executeHttpRequest(
      destination, {
      method: 'GET',
      url: getFolderByPathURL
    }
    );
    return response.data.properties["cmis:objectId"].value;
  } catch {
    return null;
  }
}

async function createFolder(req, credentials, attachments, customFolderName, destination) {
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

  let response = null;
  try {
    response = await executeHttpRequest(
      destination, {
      method: 'POST',
      url: folderCreateURL,
      data: formData
    }
    )
  } catch (error) {
    response = error;
  }
  return response
}

async function createAttachment(
  data,
  credentials,
  parentId, destination
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
  let propIndex = 2;
  if (data.note && !data.note.startsWith("__BASELINE_URL__:")) {
    formData.append(`propertyId[${propIndex}]`, "cmis:description");
    formData.append(`propertyValue[${propIndex}]`, data.note);
    propIndex++;
  }
  if (data.mimeType?.toLowerCase() === "application/internet-shortcut") {
    formData.append(`propertyId[${propIndex}]`, "cmis:secondaryObjectTypeIds");
    formData.append(`propertyValue[${propIndex}]`, "sap:createLink");
    propIndex++;
    formData.append(`propertyId[${propIndex}]`, "sap:linkRepositoryId");
    formData.append(`propertyValue[${propIndex}]`, repositoryId);
    propIndex++;
    formData.append(`propertyId[${propIndex}]`, "sap:linkExternalURL");
    formData.append(`propertyValue[${propIndex}]`, data.linkUrl);
  } else {
    formData.append("filename", data.content, {
      name: "file",
      filename: data.filename,
    });
  }
  let response = null;
  try {
    response = await executeHttpRequest(
      destination, {
      method: 'POST',
      url: documentCreateURL, data: formData
    },
    );
  } catch (error) {
    response = error;
  }

  return response;
}

async function editLink(objectId, filename, linkUrl, credentials, destination) {
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

  let response = null;
  try {
    response = await executeHttpRequest(
      destination, {
      method: 'POST',
      url: editLinkURL,
      data: formData
    }
    );
  } catch (error) {
    response = error;
  }
  return response;
}

async function deleteAttachmentsOfFolder(credentials, destination, objectId) {
  const { repositoryId } = getConfigurations();
  const documentDeleteURL =
    credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "delete");
  formData.append("objectId", objectId);
  try {
    const response = await executeHttpRequest(
      destination, {
      method: 'POST',
      url: documentDeleteURL,
      data: formData
    }
    );
    return response;
  } catch (error) {
    // Return error in a format that handleRequest can process
    return {
      status: error.response?.status,
      response: error.response,
      message: error.response?.statusText || error.message
    };
  }
}

async function deleteFolderWithAttachments(credentials, destination, parentId) {
  const { repositoryId } = getConfigurations();
  const folderDeleteURL = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "deleteTree");
  formData.append("objectId", parentId);
  try {
    const response = await executeHttpRequest(
      destination, {
      method: 'POST',
      url: folderDeleteURL,
      data: formData
    }
    );
    return response;
  } catch (error) {
    // Return error in a format that handleRequest can process
    return {
      status: error.response?.status,
      response: error.response,
      message: error.response?.statusText || error.message
    };
  }
}

async function getAttachment(uri, destination, objectId) {
  const { repositoryId } = getConfigurations();
  const getAttachmentURL =
    uri
    + "browser/"
    + repositoryId
    + "/root?"
    + "cmisselector=object&objectId="
    + objectId
    + "&succinct=true";

  try {
    return await executeHttpRequest(
      destination, {
      method: 'GET',
      url: getAttachmentURL
    }
    );
  } catch (error) {
    let statusText = errorMessage;
    if (error.response?.statusText) {
      statusText = error.response.statusText;
    }
    return statusText;
  }
}


//Updates an attachment in the SDM repository.
async function updateAttachment(
  req,
  attachment,
  credentials,
  destination,
  updatedSecondaryProperties,
  secondaryPropertiesWithInvalidDefinitions
) {
  const { repositoryId } = getConfigurations();
  const objectId = attachment.url;

  // Fetch secondary types
  let secondaryTypes;
  try {
    secondaryTypes = await getSecondaryTypes(repositoryId, destination, credentials);
  } catch (error) {
    if (error.response?.status === 403) {
      return error.status;
    }
    console.log("Error fetching secondary types:", error);
    return 500;
  }

  // Fetch valid secondary properties
  const validSecondaryProperties = await getValidSecondaryProperties(
    req,
    secondaryTypes,
    credentials,
    repositoryId,
    destination
  );

  cache.set(repositoryId, secondaryTypes);
  cache.set(`validSecondaryProperties_${repositoryId}`, validSecondaryProperties);

  // Adding the properties which are unsupported to a list so that exeception can be thrown
  const keysToRemove = Object.keys(updatedSecondaryProperties).filter(
    (key) => key !== "cmis:name" && key !== "cmis:description" && !validSecondaryProperties.includes(key)
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

  // Send the request
  try {
    const response = await executeHttpRequest(
      destination, {
      method: 'POST',
      url: updateURL,
      data: formData
    }
    );
    return response.status; // Return the HTTP status code
  } catch (error) {
    if (error?.response?.status === 400) {
      const jsonResponse = await error.response.json();
      const message = jsonResponse.message;
      throw new Error(message);
    }
    if (error?.response?.status === 409) {
      const sdmMessage = error.response?.data?.message || '';
      const match = sdmMessage.match(/Child\s+(\S+)\s+with\s+Id/);
      const name = match ? match[1] : objectId;
      throw new Error(`An object named "${name}" already exists. Rename the object to a different name.`);
    }
    if (error.response?.status) {
      return error.response.status;
    }
    throw new Error(updateAttachmentError, error);
  }
}

//Fetches secondary types from the SDM repository with caching.
async function getSecondaryTypes(repositoryId, destination, credentials) {
  const cacheKey = repositoryId;
  let secondaryTypes = cache.get(cacheKey);

  if (!secondaryTypes) {
    const sdmUrl = `${credentials.uri}browser/${repositoryId}?cmisselector=typeDescendants`;

    try {
      // Send the GET request using executeHttpRequest
      const response = await executeHttpRequest(
        destination, {
        method: 'GET',
        url: sdmUrl
      }
      );

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
      if (error.response?.status === 403) {
        throw error;
      }
      throw new Error('Could not update the attachment', error);
    }
  }

  return secondaryTypes;
}

//Fetches valid secondary properties from the SDM repository with caching.
async function getValidSecondaryProperties(req, secondaryTypes, sdmCredentials, repositoryId, destination) {
  const cacheKey = `validSecondaryProperties_${repositoryId}`;
  let validSecondaryProperties = cache.get(cacheKey);

  if (!validSecondaryProperties) {
    validSecondaryProperties = [];

    for (let i = secondaryTypes.length - 1; i >= 0; i--) {
      const typeId = secondaryTypes[i];
      const sdmUrl = `${sdmCredentials.uri}browser/${repositoryId}?cmisselector=typeDefinition&typeID=${typeId}`;

      try {
        // Send the GET request using executeHttpRequest
        const response = await executeHttpRequest(
          destination, {
          method: 'GET',
          url: sdmUrl
        }
        );

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
