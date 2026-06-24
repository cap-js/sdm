const { getConfigurations, extractSecondaryTypeIds, checkMCM, prepareSecondaryProperties, getContentLength } = require("../util");
const FormData = require("form-data");
const { errorMessage, updateAttachmentError, unsupportedProperties } = require("../util/messageConsts");
const NodeCache = require("node-cache");
const cache = new NodeCache({ stdTTL: 3600 });
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const ReadAheadStream = require('../ReadAheadStream');

const CHUNK_SIZE = 20 * 1024 * 1024;          // 20 MB per chunk
const FILE_SIZE_THRESHOLD = 400 * 1024 * 1024; // switch to chunked above 400 MB
const CLEANUP_MAX_RETRIES = 3;                 // orphan delete retries
const CLEANUP_BASE_DELAY_MS = 2000;            // 2 s, 4 s, 8 s backoff


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

/**
 * Route upload to single-chunk or multi-chunk path based on file size.
 * Files <= 400 MB go through the original single-POST path.
 * Files >  400 MB are uploaded via createEmptyDocument + appendContentStream.
 */
async function createAttachment(data, credentials, parentId, destination) {
  const { repositoryId } = getConfigurations();
  const totalSize = data.contentLength > 0
    ? data.contentLength
    : getContentLength(data.content);

  console.log(`[createAttachment] filename=${data.filename} totalSize=${totalSize} threshold=${FILE_SIZE_THRESHOLD}`);

  if (totalSize > FILE_SIZE_THRESHOLD) {
    console.log(`[createAttachment] Large file detected (${totalSize} bytes). Using chunked upload.`);
    return uploadLargeFileInChunks(data, credentials, parentId, repositoryId, destination, totalSize);
  }

  return uploadSingleChunk(data, credentials, parentId, repositoryId, destination);
}

/**
 * Original single-POST upload path (files <= 400 MB).
 */
async function uploadSingleChunk(data, credentials, parentId, repositoryId, destination) {
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
  let response = null;
  try {
    response = await executeHttpRequest(destination, {
      method: 'POST',
      url: documentCreateURL,
      data: formData,
    });
  } catch (error) {
    response = error;
  }
  return response;
}

/**
 * POST to CMIS to create an empty placeholder document.
 * Returns the objectId to be used as the target for appendContentStream calls.
 */
async function createEmptyDocument(filename, parentId, credentials, repositoryId, destination) {
  console.log(`[createEmptyDocument] Creating placeholder for "${filename}" in parent ${parentId}`);
  const url = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "createDocument");
  formData.append("objectId", parentId);
  formData.append("propertyId[0]", "cmis:name");
  formData.append("propertyValue[0]", filename);
  formData.append("propertyId[1]", "cmis:objectTypeId");
  formData.append("propertyValue[1]", "cmis:document");
  formData.append("succinct", "true");

  const response = await executeHttpRequest(destination, {
    method: 'POST',
    url,
    data: formData,
  });

  const objectId = response.data?.succinctProperties?.["cmis:objectId"];
  console.log(`[createEmptyDocument] Placeholder created objectId=${objectId}`);
  return { response, objectId };
}

/**
 * Append one chunk to an existing SDM document.
 * isLastChunk=true causes CMIS to finalise and hash-verify the document.
 */
async function appendContentStream(
  objectId, filename, chunkBuffer, isLastChunk,
  { credentials, repositoryId, destination, chunkIndex }
) {
  const url = credentials.uri + "browser/" + repositoryId + "/root";
  const formData = new FormData();
  formData.append("cmisaction", "appendContent");
  formData.append("objectId", objectId);
  formData.append("isLastChunk", String(isLastChunk));
  formData.append("succinct", "true");
  formData.append("media", chunkBuffer, { filename });

  try {
    return await executeHttpRequest(destination, { method: 'POST', url, data: formData });
  } catch (error) {
    console.error(`[appendContentStream] Chunk ${chunkIndex} failed`, {
      objectId, filename, isLastChunk,
      status: error.response?.status,
      sdmMessage: error.response?.data?.message,
    });
    throw new Error(`Error appending chunk ${chunkIndex}: ${error.message}`);
  }
}

/**
 * Attempt to delete an incomplete SDM document, retrying with exponential
 * backoff up to CLEANUP_MAX_RETRIES times to handle transient network failures.
 *
 * Failures are logged but never re-thrown so the original upload error is
 * always what propagates to the caller. Any objectId that cannot be cleaned up
 * here will be reconciled by the startup orphan-queue job.
 */
async function deleteIncompleteDocumentWithRetry(objectId, credentials, destination) {
  for (let attempt = 1; attempt <= CLEANUP_MAX_RETRIES; attempt++) {
    try {
      await deleteAttachmentsOfFolder(credentials, destination, objectId);
      console.log(`[orphan-cleanup] Deleted incomplete document objectId=${objectId} on attempt ${attempt}`);
      return true;
    } catch (cleanupError) {
      const delayMs = CLEANUP_BASE_DELAY_MS * Math.pow(2, attempt - 1); // 2s, 4s, 8s
      console.error(
        `[orphan-cleanup] Attempt ${attempt}/${CLEANUP_MAX_RETRIES} failed for objectId=${objectId}: ${cleanupError.message}. ` +
        (attempt < CLEANUP_MAX_RETRIES ? `Retrying in ${delayMs / 1000}s.` : 'Giving up — recording in orphan queue.')
      );
      if (attempt < CLEANUP_MAX_RETRIES) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
    }
  }
  return false;
}

/**
 * Chunked upload for files > 400 MB.
 *
 * IMPORTANT: We must NOT buffer the full content into memory.
 * CDS delivers req.data.content as a Buffer (for bodies up to the busboy limit).
 * We pass that Buffer directly to ReadAheadStream which reads it in 20 MB windows.
 * If content is already a Readable stream we read from it without accumulating.
 *
 * Flow:
 *   1. createEmptyDocument  → get objectId
 *   2. Record objectId in orphan queue
 *   3. Loop: ReadAheadStream.readBytes → appendContentStream
 *   4. On success: remove from orphan queue
 *   5. On failure: retry-delete; orphan queue entry survives for reconciliation job.
 */
async function uploadLargeFileInChunks(data, credentials, parentId, repositoryId, destination, totalSize) {
  let readAheadStream = null;
  let chunkIndex = 0;
  let objectId = null;

  try {
    // Step 1 — create the empty placeholder
    const { objectId: newObjectId } =
      await createEmptyDocument(data.filename, parentId, credentials, repositoryId, destination);

    if (!newObjectId) throw new Error('createEmptyDocument returned no objectId');
    objectId = newObjectId;

    // Step 2 — write objectId into the orphan queue before touching data
    if (typeof data.enqueueOrphan === 'function') {
      await data.enqueueOrphan(objectId, repositoryId, data.filename);
    }

    // Step 3 — feed content directly to ReadAheadStream without full buffering.
    // CDS delivers req.data.content as a Buffer (body already parsed by busboy).
    // Passing the Buffer directly means ReadAheadStream only holds ≤4×20MB=80MB
    // in its queue at any time — the rest of the Buffer is referenced but not copied.
    const content = data.content;
    if (!content) throw new Error('No content provided for large file upload');

    readAheadStream = new ReadAheadStream(content, totalSize, CHUNK_SIZE);
    await readAheadStream.startReading();

    const chunkBuffer = Buffer.allocUnsafe(CHUNK_SIZE);
    let finalResponse = null;

    while (true) {
      const startTs = Date.now();
      let bytesRead = await readAheadStream.readBytes(chunkBuffer, 0, CHUNK_SIZE);

      // Handle premature EOF with data still queued
      if (bytesRead === -1 && !readAheadStream.isChunkQueueEmpty()) {
        console.log('[uploadLargeFileInChunks] Premature EOF — draining last chunk from queue');
        const lastChunk = await readAheadStream.getLastChunkFromQueue();
        bytesRead = lastChunk.length;
        lastChunk.copy(chunkBuffer, 0, 0, bytesRead);
      }

      if (bytesRead <= 0) break;

      const isLastChunk = bytesRead < CHUNK_SIZE || readAheadStream.isEOFReached();
      const actualChunk = chunkBuffer.slice(0, bytesRead);

      const response = await appendContentStream(
        objectId, data.filename, actualChunk, isLastChunk,
        { credentials, repositoryId, destination, chunkIndex }
      );

      if (isLastChunk) finalResponse = response;

      console.log(
        `[uploadLargeFileInChunks] Chunk ${chunkIndex}: ${bytesRead} bytes, isLast=${isLastChunk}, ` +
        `took ${Date.now() - startTs}ms`
      );

      chunkIndex++;
      if (isLastChunk) break;
    }

    // Step 4 — success: remove from orphan queue
    if (typeof data.dequeueOrphan === 'function') {
      await data.dequeueOrphan(objectId);
    }

    return finalResponse;

  } catch (error) {
    const isClientDisconnect = error.message && (
      error.message.includes('Stream closed by client disconnect') ||
      error.message.includes('Request aborted by client') ||
      error.message.includes('aborted')
    );

    console.error(`[uploadLargeFileInChunks] Upload failed`, {
      filename: data.filename,
      chunkIndex,
      isClientDisconnect,
      totalSize,
      objectId,
      error: error.message,
    });

    // Step 5 — attempt cleanup with retry backoff
    if (objectId) {
      const cleaned = await deleteIncompleteDocumentWithRetry(objectId, credentials, destination);
      if (cleaned && typeof data.dequeueOrphan === 'function') {
        // Cleanup succeeded: remove from orphan queue
        await data.dequeueOrphan(objectId);
      }
      // If !cleaned: orphan queue entry remains for the reconciliation job
    }

    throw error;

  } finally {
    if (readAheadStream) await readAheadStream.close();
  }
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
  updateAttachment,
  deleteIncompleteDocumentWithRetry,
};
