'use strict';

const path = require('path');
const { run, runAndCaptureOutput } = require('./shell-script-runner');

const SCRIPTS_DIR = __dirname;
const CREATE_SCRIPT = path.join(SCRIPTS_DIR, 'create.sh');
const GET_OBJECT_ID_SCRIPT = path.join(SCRIPTS_DIR, 'get-object-id.sh');
const DELETE_SCRIPT = path.join(SCRIPTS_DIR, 'delete.sh');
const READ_SCRIPT = path.join(SCRIPTS_DIR, 'read.sh');
const GET_METADATA_SCRIPT = path.join(SCRIPTS_DIR, 'get-metadata.sh');

/**
 * Extracts the value after the last ": " in a line, or returns the line as-is.
 */
function extractId(line) {
  if (line && line.includes(': ')) {
    return line.substring(line.lastIndexOf(': ') + 2).trim();
  }
  return line;
}

/**
 * Resolves the CMIS parent folder ID from `entityId + "__attachments"`, then uploads
 * a local file to that folder via create.sh.
 *
 * @param {string} cmisName - the name the document will have in the CMIS repository
 * @param {string} filePath - path to the local file to upload
 * @param {string} entityId - the entity ID whose attachments folder is the upload target
 */
async function createDocumentInCmis(cmisName, filePath, entityId) {
  const folderLine = await runAndCaptureOutput(GET_OBJECT_ID_SCRIPT, entityId);
  const parentFolderObjectId = extractId(folderLine);
  console.log('Resolved parent folder object ID:', parentFolderObjectId);

  const exitCode = await run(CREATE_SCRIPT, cmisName, filePath, parentFolderObjectId);
  if (exitCode !== 0) {
    throw new Error(`create.sh exited with non-zero code: ${exitCode}`);
  }
}

/**
 * Resolves the CMIS object ID of a document by name inside the folder named
 * `entityId + "__attachments"`, then deletes it via the delete.sh script.
 *
 * @param {string} entityId - the entity ID whose attachments folder is the parent
 * @param {string} fileName - the cmis:name of the document to delete
 */
async function deleteDocumentFromCmis(entityId, fileName) {
  // Step 1: resolve the parent folder object ID
  const folderLine = await runAndCaptureOutput(GET_OBJECT_ID_SCRIPT, entityId);
  const parentFolderObjectId = extractId(folderLine);
  console.log('Resolved parent folder object ID:', parentFolderObjectId);

  // Step 2: resolve the document object ID by filename inside the parent folder
  const docLine = await runAndCaptureOutput(GET_OBJECT_ID_SCRIPT, fileName, parentFolderObjectId, 'cmis:document');
  const documentObjectId = extractId(docLine);
  console.log('Resolved document object ID:', documentObjectId);

  // Step 3: delete the document
  const exitCode = await run(DELETE_SCRIPT, documentObjectId, parentFolderObjectId);
  if (exitCode !== 0) {
    throw new Error(`delete.sh failed with exit code: ${exitCode}`);
  }
}

/**
 * Reads (downloads) a CMIS document by resolving its object ID from the entity's
 * attachments folder, then downloads it to the specified output path via read.sh.
 *
 * @param {string} entityId - the entity ID whose attachments folder contains the document
 * @param {string} fileName - the cmis:name of the document to read
 * @param {string} outputPath - local path to save the downloaded content
 */
async function readDocumentFromCmis(entityId, fileName, outputPath) {
  const folderLine = await runAndCaptureOutput(GET_OBJECT_ID_SCRIPT, entityId);
  const parentFolderObjectId = extractId(folderLine);
  console.log('Resolved parent folder object ID:', parentFolderObjectId);

  const docLine = await runAndCaptureOutput(GET_OBJECT_ID_SCRIPT, fileName, parentFolderObjectId, 'cmis:document');
  const documentObjectId = extractId(docLine);
  console.log('Resolved document object ID:', documentObjectId);

  const exitCode = await run(READ_SCRIPT, documentObjectId, outputPath);
  if (exitCode !== 0) {
    throw new Error(`read.sh exited with non-zero code: ${exitCode}`);
  }
}

/**
 * Reads CMIS metadata (properties) for a document by resolving its object ID from
 * the entity's attachments folder, then fetching its properties via get-metadata.sh.
 *
 * @param {string} entityId - the entity ID whose attachments folder contains the document
 * @param {string} fileName - the cmis:name of the document to get metadata for
 * @returns {Promise<string>} the JSON metadata string returned by the CMIS API
 */
async function readDocumentMetadataFromCmis(entityId, fileName) {
  const folderLine = await runAndCaptureOutput(GET_OBJECT_ID_SCRIPT, entityId);
  const parentFolderObjectId = extractId(folderLine);
  console.log('Resolved parent folder object ID:', parentFolderObjectId);

  const docLine = await runAndCaptureOutput(GET_OBJECT_ID_SCRIPT, fileName, parentFolderObjectId, 'cmis:document');
  const documentObjectId = extractId(docLine);
  console.log('Resolved document object ID:', documentObjectId);

  const metadata = await runAndCaptureOutput(GET_METADATA_SCRIPT, documentObjectId);
  console.log('Document metadata retrieved successfully');
  return metadata;
}

/**
 * Retrieves the value of a specific CMIS property for a document.
 *
 * @param {string} entityId - the entity ID whose attachments folder contains the document
 * @param {string} fileName - the cmis:name of the document
 * @param {string} propertyName - the CMIS property name (e.g. "cmis:createdBy")
 * @returns {Promise<string|null>} the property value as a string, or null if not found
 */
async function getCmisProperty(entityId, fileName, propertyName) {
  const metadata = await readDocumentMetadataFromCmis(entityId, fileName);
  const root = JSON.parse(metadata);
  const value = root?.properties?.[propertyName]?.value;
  if (value === undefined) {
    throw new Error(`CMIS property '${propertyName}' not found in metadata`);
  }
  return String(value);
}

/**
 * Like getCmisProperty but returns null instead of throwing when the property is not found
 * or when the document/folder cannot be resolved.
 *
 * @param {string} entityId - the entity ID whose attachments folder contains the document
 * @param {string} fileName - the cmis:name of the document
 * @param {string} propertyName - the CMIS property name (e.g. "Working:DocumentInfoRecordString")
 * @returns {Promise<string|null>} the property value as a string, or null if not found
 */
async function getCmisPropertyOrNull(entityId, fileName, propertyName) {
  try {
    const metadata = await readDocumentMetadataFromCmis(entityId, fileName);
    const root = JSON.parse(metadata);
    const value = root?.properties?.[propertyName]?.value;
    return value !== undefined && value !== null ? String(value) : null;
  } catch {
    return null;
  }
}

module.exports = {
  createDocumentInCmis,
  deleteDocumentFromCmis,
  readDocumentFromCmis,
  readDocumentMetadataFromCmis,
  getCmisProperty,
  getCmisPropertyOrNull
};
