const { getConfigurations, extractSecondaryTypeIds, checkMCM, prepareSecondaryProperties, getContentLength } = require("../util");
const FormData = require("form-data");
const { errorMessage, updateAttachmentError, unsupportedProperties } = require("../util/messageConsts");
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 3600 });
const {executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { Readable } = require('stream');
const ReadAheadStream = require('../ReadAheadStream');

// Constants for large file upload
const CHUNK_SIZE = 20 * 1024 * 1024; // 20MB chunk size
const FILE_SIZE_THRESHOLD = 400 * 1024 * 1024; // 400MB threshold

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
      destination,{
        method: 'GET',
        url:documentReadURL,
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
      destination,{
        method: 'GET',
        url:getRepoInfoUrl
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
      destination,{
        method: 'GET',
        url:getFolderByPathURL
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
      destination,{
        method: 'GET',
        url:getFolderByPathURL
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
  parentId,
  destination
) {
  const { repositoryId } = getConfigurations();

  // Handle link type uploads (no chunking needed)
  if (data.mimeType?.toLowerCase() === "application/internet-shortcut") {
    return await uploadSingleChunk(data, credentials, parentId, repositoryId, destination);
  }
  
  // Get content length - use explicit contentLength from HTTP headers if provided,
  // otherwise try to detect from content stream properties
  const contentLength = (data.contentLength && data.contentLength > 0) 
    ? data.contentLength 
    : getContentLength(data.content);
  
  console.log(`[createAttachment] File size: ${contentLength} bytes, Threshold: ${FILE_SIZE_THRESHOLD} bytes`);
  
  // Upload directly if file is ≤ 400MB or content length cannot be determined
  if (contentLength <= FILE_SIZE_THRESHOLD || contentLength === -1) {
    console.log(`[createAttachment] Uploading file as single chunk`);
    return await uploadSingleChunk(data, credentials, parentId, repositoryId, destination);
  }
  
  // Upload in chunks if file is > 400MB
  console.log(`[createAttachment] Uploading file in chunks`);
  return await uploadLargeFileInChunks(data, credentials, parentId, repositoryId, destination, contentLength);
}

// Upload file in a single chunk
async function uploadSingleChunk(data, credentials, parentId, repositoryId, destination) {
  console.log(`[uploadSingleChunk] Starting upload`, {
    filename: data.filename,
    mimeType: data.mimeType,
    parentId,
    repositoryId
  });
  
  const documentCreateURL = credentials.uri + "browser/" + repositoryId + "/root";
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
    
  console.log(`[uploadSingleChunk] Sending HTTP request`, {
    url: documentCreateURL,
    filename: data.filename
  });
  
  const response = await executeHttpRequest(
    destination, {
      method: 'POST',
      url: documentCreateURL,
      data: formData
    }
  );
  
  console.log(`[uploadSingleChunk] Upload successful`, {
    filename: data.filename,
    status: response.status,
    objectId: response.data?.succinctProperties?.["cmis:objectId"]
  });
  
  return response;
}

// Create an empty document in SDM (for large file uploads)
async function createEmptyDocument(filename, parentId, credentials, repositoryId, destination) {
  console.log(`[createEmptyDocument] Creating empty document`, {
    filename,
    parentId,
    repositoryId
  });
  
  const documentCreateURL = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "createDocument");
  formData.append("objectId", parentId);
  formData.append("propertyId[0]", "cmis:name");
  formData.append("propertyValue[0]", filename);
  formData.append("propertyId[1]", "cmis:objectTypeId");
  formData.append("propertyValue[1]", "cmis:document");
  formData.append("succinct", "true");

  console.log(`[createEmptyDocument] Sending HTTP request to create empty document`);
  
  const response = await executeHttpRequest(
    destination, {
      method: 'POST',
      url: documentCreateURL,
      data: formData
    },
  );
  
  console.log(`[createEmptyDocument] Empty document created`, {
    status: response.status,
    objectId: response.data?.succinctProperties?.["cmis:objectId"]
  });
  
  return response;
}

// Append content stream to existing document
async function appendContentStream(objectId, filename, chunkBuffer, isLastChunk, credentials, repositoryId, destination, chunkIndex = 0) {
  const documentCreateURL = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "appendContent");
  formData.append("objectId", objectId);
  formData.append("propertyId[0]", "cmis:name");
  formData.append("propertyValue[0]", filename);
  formData.append("propertyId[1]", "cmis:objectTypeId");
  formData.append("propertyValue[1]", "cmis:document");
  formData.append("isLastChunk", String(isLastChunk));
  formData.append("filename", filename);
  formData.append("succinct", "true");
  formData.append("media", chunkBuffer, {
    filename: filename
  });
  
  try {
    const response = await executeHttpRequest(
      destination, {
        method: 'POST',
        url: documentCreateURL,
        data: formData
      }
    );
    return response;
  } catch (error) {
    console.error(`[appendContentStream] Error appending chunk ${chunkIndex}`, {
      errorMessage: error.message,
      errorType: error.constructor?.name,
      status: error.response?.status,
      sdmMessage: error.response?.data?.message,
      objectId,
      filename,
      isLastChunk,
      chunkIndex
    });
    throw new Error(`Error in appending content chunk ${chunkIndex}: ${error.message}`);
  }
}

// Upload large file in chunks using ReadAheadStream for parallel I/O
async function uploadLargeFileInChunks(data, credentials, parentId, repositoryId, destination, totalSize) {
  let chunkedStream = null;
  let chunkIndex = 0; // Declare outside try block so it's accessible in catch
  let objectId = null; // Track objectId for cleanup on failure
  
  try {
    // Step 1: Create empty document and get objectId for subsequent chunk uploads
    const emptyDocResponse = await createEmptyDocument(data.filename, parentId, credentials, repositoryId, destination);
    console.log(`[uploadLargeFileInChunks] Response Body: ${JSON.stringify(emptyDocResponse.data)}`);
    
    objectId = emptyDocResponse.data?.succinctProperties?.["cmis:objectId"];
    if (!objectId) {
      throw new Error("Failed to create empty document - no objectId returned");
    }
    console.log(`[uploadLargeFileInChunks] objectId of empty doc is ${objectId}`);
    
    // Step 2: Initialize stream with read-ahead capability
    chunkedStream = new ReadAheadStream(data.content, totalSize, CHUNK_SIZE);
    
    // Start background reading task - this launches a parallel async task that continuously
    // reads chunks into a queue. We await only until the first chunk is ready, then the
    // background task continues running in parallel while we upload chunks below.
    await chunkedStream.startReading();
    
    // Step 3: Upload Chunks Sequentially (while background task reads ahead in parallel)
    chunkIndex = 0;
    let chunkBuffer = Buffer.allocUnsafe(CHUNK_SIZE);
    let bytesRead;
    let hasMoreChunks = true;
    let finalResponse = null;
    
    while (hasMoreChunks) {
      const startChunkUploadTime = Date.now();
      
      // Step 3: Read next chunk from stream
      bytesRead = await chunkedStream.readBytes(chunkBuffer, 0, CHUNK_SIZE);
      console.log(`[uploadLargeFileInChunks] bytesRead is ${bytesRead}`);
      
      // Check remaining bytes in stream
      const remainingBytes = chunkedStream.getRemainingBytes();
      console.log(`[uploadLargeFileInChunks] remainingBytes is ${remainingBytes}`);
      
      // Determine if this is the last chunk
      let isLastChunk = bytesRead < CHUNK_SIZE || chunkedStream.isEOFReached();
      
      // Handle premature EOF by fetching from queue if needed
      if (bytesRead === -1 && !chunkedStream.isChunkQueueEmpty()) {
        console.log('[uploadLargeFileInChunks] Premature exit detected. Fetching last chunk from queue...');
        const lastChunk = await chunkedStream.getLastChunkFromQueue();
        bytesRead = lastChunk.length;
        lastChunk.copy(chunkBuffer, 0, 0, bytesRead);
        isLastChunk = true; // It has to be the last chunk
      }
      
      // Log chunk processing details
      console.log(
        `[uploadLargeFileInChunks] Chunk ${chunkIndex} | BytesRead: ${bytesRead} | RemainingBytes: ${remainingBytes} | isLastChunk? ${isLastChunk}`
      );
      
      // Upload chunk to server (while background task continues reading next chunks)
      if (bytesRead > 0) {
        // Trim buffer to actual bytes read
        const actualChunk = chunkBuffer.slice(0, bytesRead);
        
        // Only capture response from the last chunk to avoid unnecessary object allocation
        if (isLastChunk) {
          finalResponse = await appendContentStream(
            objectId,
            data.filename,
            actualChunk,
            isLastChunk,
            credentials,
            repositoryId,
            destination
          );
        } else {
          await appendContentStream(
            objectId,
            data.filename,
            actualChunk,
            isLastChunk,
            credentials,
            repositoryId,
            destination
          );
        }
      }
      
      const endChunkUploadTime = Date.now();
      console.log(
        `[uploadLargeFileInChunks] Chunk ${chunkIndex} having ${bytesRead} bytes is read and it took ${Math.floor((endChunkUploadTime - startChunkUploadTime) / 1000)} seconds`
      );
      
      chunkIndex++;
      
      if (isLastChunk) {
        hasMoreChunks = false;
      }
    }
    
    return finalResponse;
    
  } catch (error) {
    // Identify client disconnect scenarios
    const isClientDisconnect = error.message && (
      error.message.includes('Stream closed by client disconnect') ||
      error.message.includes('Request aborted by client') ||
      error.message.includes('aborted')
    );
    
    if (isClientDisconnect) {
      console.warn(`[uploadLargeFileInChunks] Client disconnected during upload (likely AppRouter timeout)`, {
        filename: data.filename,
        chunkIndex: chunkIndex || 0,
        bytesUploadedSoFar: (chunkIndex || 0) * CHUNK_SIZE,
        totalSize,
        percentComplete: ((chunkIndex || 0) * CHUNK_SIZE / totalSize * 100).toFixed(2)
      });
    }
    
    console.error(`[uploadLargeFileInChunks] Exception during chunked upload`, {
      filename: data.filename,
      errorMessage: error.message,
      errorType: error.constructor?.name,
      isClientDisconnect,
      errorStack: error.stack,
      status: error.response?.status,
      sdmMessage: error.response?.data?.message,
      sdmException: error.response?.data?.exception,
      totalSize,
      chunkIndex: chunkIndex || 0,
      objectId
    });
    
    // Cleanup: Delete the empty/incomplete document from SDM to avoid duplicate errors on retry
    if (objectId) {
      try {
        console.log(`[uploadLargeFileInChunks] Cleaning up incomplete upload - deleting objectId: ${objectId}`);
        await deleteAttachmentsOfFolder(credentials, destination, objectId);
        console.log(`[uploadLargeFileInChunks] Successfully deleted incomplete document: ${objectId}`);
      } catch (cleanupError) {
        console.error(`[uploadLargeFileInChunks] Failed to cleanup incomplete document: ${objectId}`, {
          cleanupError: cleanupError.message
        });
        // Don't throw cleanup error - preserve original error
      }
    }
    
    throw error; // Re-throw original error to preserve SDM error details
  } finally {
    // Close the stream
    if (chunkedStream) {
      await chunkedStream.close();
    }
  }
}

// Helper function to convert stream to buffer
async function streamToBuffer(stream) {
  // If it's already a buffer, return it
  if (Buffer.isBuffer(stream)) {
    return stream;
  }
  
  // If it's a readable stream, convert it to buffer
  if (stream instanceof Readable) {
    const chunks = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  
  // If it's some other type, try to convert it
  return Buffer.from(stream);
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

  const response = await executeHttpRequest(
    destination,{
      method: 'POST',
      url:editLinkURL,
      data: formData
    }
  );
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
      destination,{
        method: 'POST',
        url:documentDeleteURL,
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
      destination,{
        method: 'POST',
        url:folderDeleteURL,
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
      destination,{
        method: 'GET',
        url:getAttachmentURL
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

  // Send the request
  try {
    const response = await executeHttpRequest(
      destination,{
        method: 'POST',
        url:updateURL,
        data: formData
      }
    );
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
async function getSecondaryTypes(repositoryId, destination, credentials) {
  const cacheKey = repositoryId;
  let secondaryTypes = cache.get(cacheKey);

  if (!secondaryTypes) {
    const sdmUrl = `${credentials.uri}browser/${repositoryId}?cmisselector=typeDescendants`;

    try {
      // Send the GET request using executeHttpRequest
      const response = await executeHttpRequest(
        destination,{
          method: 'GET',
          url:sdmUrl
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
          destination,{
            method: 'GET',
            url:sdmUrl
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
  updateAttachment,
  uploadSingleChunk,
  createEmptyDocument,
  appendContentStream,
  uploadLargeFileInChunks,
  ReadAheadStream
};
