const cds = require('@sap/cds');
const convertObjectToCmisProperties = require('./converters/object-to-cmis-document');
const builder = require('./request-builders');
const middlewares = require('./middlewares');
const jsonToFormdata = require('./converters/json-to-formdata');
const { Readable } = require('stream');

/**
 * @typedef {import('./types').BaseCmisOptions} BaseCmisOptions
 * @typedef {import('./types').WriteOptions} WriteOptions
 * @typedef {import('./types').OptionsConfig} OptionsConfig
 * @typedef {import('@sap-cloud-sdk/openapi').OpenApiRequestBuilder} OpenApiRequestBuilder
 */

module.exports = class CmisClient extends cds.Service {
  constructor(args) {
    super(args);

    this.globalParameters = {
      _charset: 'UTF-8',
      succinct: true,
    };
  }

  /**
   * Creates a folder object in the speciﬁed location.
   * If no objectId is given, then creates it in the root folder.
   * @param {string} repositoryId - Repository ID.
   * @param {string} name - Folder name.
   * @param {string} objectId - Object ID of folder where folder is to be created.
   * @param {string} description - Description of the folder.
   * @returns
   */
  createFolder(repositoryId, name, objectId, description) {
    const cmisProperties = {};
    if (description !== null) {
      cmisProperties['cmis:description'] = description;
    }
    cmisProperties['cmis:name'] = name;
    cmisProperties['cmis:objectTypeId'] = 'cmis:folder';
    const allCmisProperties = convertObjectToCmisProperties({...cmisProperties});
    const requestBody = {
      cmisaction: 'createFolder',
      ...allCmisProperties,
      ...this.globalParameters,
      ...(objectId !== null ? { 'objectId': objectId } : {})
    };

    let request;
    request = builder.createBrowserRootByRepositoryId(
      repositoryId,
      requestBody,
    );

    const config = {};
    config.middleware = [
      ...[].concat(config?.middleware || []).flat(),
      middlewares.jsonToFormData,
    ];

    return this._buildRequest(request, config);
  }

  /**
   * Creates a document object in the speciﬁed location.
   * If no objectId is given, then creates it in the root folder.
   * @param {string} repositoryId - Repository ID.
   * @param {string} name - Document name.
   * @param {string} objectId - Object ID of folder where document is to be created.
   * @param {string} description - Description of the document.
   * @param {Buffer | Readable} content - Document content.
   * @returns
   */
  createDocument(repositoryId, name, objectId, description, content) {
    const cmisProperties = {};
    cmisProperties['cmis:name'] = name;
    cmisProperties['cmis:objectTypeId'] = 'cmis:document';
    const allCmisProperties = convertObjectToCmisProperties({...cmisProperties});

    const bodyData = {
      cmisaction: 'createDocument',
      media: 'binary',
      ...allCmisProperties,
      ...this.globalParameters
    };
    const requestBody = jsonToFormdata(bodyData);
    
    requestBody.append('filename', content, {
      filename: name
    });

    const request = builder.createBrowserRootByRepositoryId(repositoryId, requestBody);
    const config = {};
    return this._buildRequest(request, config);
  }

  /**
   * Incorporates the provided configuration options into the specified request object.
   *
   * @param {OpenApiRequestBuilder} request
   * @param {OptionsConfig} config
   * @returns {OpenApiRequestBuilder}
   */
  _buildRequest(request, config) {
    if (config?.customHeaders) {
      request = request.addCustomHeaders(config.customHeaders);
    }

    if (config?.customRequestConfiguration) {
      request = request.addCustomRequestConfiguration(
        config?.customRequestConfiguration,
      );
    }

    if (config?.middleware) {
      request = request.middleware(config.middleware);
    }

    return request;
  }
};
