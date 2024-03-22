const { loadDestination } = require('../util');
const {
  convertCMISDocumentToOData,
  convertODataToCMISDocument
} = require('../converters');
const { getConfigurations } = require('../config');

/**
 * Transforms the request data to match the CMIS document structure.
 *
 * @param {Object} req - The request object containing data and target elements.
 * @returns {void} Modifies the `data` property of the request object in place.
 */
const beforeAll = async req => {
  const { data } = req;
  const reqParams = convertODataToCMISDocument(data, req.target.elements);
  req.reqParams = reqParams;
};

/**
 * Handles create operations.
 * @param {Object} req - The request object.
 * @returns {Promise<void>}
 */
const onCreate = async req => {
  const { repositoryId } = getConfigurations();
  const destination = await loadDestination(req);
  const { reqParams } = req;
  const objectName = reqParams['cmis:name'];
  const objectTypeId = reqParams['cmis:objectTypeId'];
  const objectId = (reqParams['cmis:objectId']) ? reqParams['cmis:objectId'] : null;
  const description = (reqParams['cmis:description']) ? reqParams['cmis:description'] : null;
  
  const srv = await cds.connect.to('cmis-client');
  if (objectTypeId !== 'cmis:document') {
    const result = await srv.createFolder(repositoryId, objectName, objectId, description).execute(destination);
    return convertCMISDocumentToOData(result, req.target.elements);
  } else {
    const content = req.data.content;
    const result = await srv.createDocument(repositoryId, objectName, objectId, description, content).execute(destination);
    return convertCMISDocumentToOData(result, req.target.elements);
  }
};

/**
 * Tries to create a specified folder. If the folder already exists, no action is taken.
 * @param {Object} req - The request object.
 * @param {string} folderName - The name of the folder to create.
 */
// const onCreateFolder = async (req, folderName) => {
//   const { repositoryId } = getConfigurations();
//   const destination = await loadDestination(req);
//   const srv = await cds.connect.to('cmis-client');
//   return await srv.createFolder(repositoryId, folderName).execute(destination);
// };

module.exports = {
  beforeAll,
  onCreate
};
