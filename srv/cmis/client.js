const cds = require('@sap/cds');
const convertObjectToCmisProperties = require('./converters/object-to-cmis-document');
const builder = require('./request-builders');
const middlewares = require('./middlewares');
const jsonToFormdata = require('./converters/json-to-formdata');

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
   * Creates a folder object of the speciﬁed type in the speciﬁed location (options.folderPath).
   * If no folderPath is given, then creates it in the root folder
   * @param {string} repositoryId - Repository ID
   * @param {string} name - Folder name
   * @param {WriteOptions & {folderPath?: string}} options - Options for the folder creation.
   * @param options - Configuration and settings for the document creation from the source.
   * @property options.folderPath - The path within the repository where the copied document will be placed. If `targetFolderId` is not provided, this path will be used. If neither are provided, the default location may be used.
   * @returns
   */
  createFolder(repositoryId, name, objectId, description) {
    const cmisProperties = {};
    if (description !== null) {
      cmisProperties['cmis:description'] = description;
    }
    cmisProperties['cmis:name'] = name;
    cmisProperties['cmis:objectTypeId'] = 'cmis:folder';
    const allCmisProperties = convertObjectToCmisProperties({
      ...cmisProperties
    });

    console.log('allCmisProperties -------');
    console.log(JSON.stringify(allCmisProperties));
    console.log('objectId -------');
    console.log(objectId);

    const requestBody = {
      cmisaction: 'createFolder',
      ...allCmisProperties,
      ...this.globalParameters,
      ...(objectId !== null ? { 'objectId': objectId } : {})
    };

    console.log('requestBody -------');
    console.log(JSON.stringify(requestBody));
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
   * Creates a new document object within the specified location in the repository.
   *
   * This method allows for the creation of a document object based on a given type, typically specified by the cmis:objectTypeId property.
   *
   * @param {string} repositoryId - Repository ID
   * @param {string} name - The name that will be assigned to the document object.
   * @param {any} content - The actual content/data of the document to be stored.
   * @param {WriteOptions & { folderPath?: string; versioningState?: 'none' | 'checkedout' | 'major' | 'minor'; }} options - Options for document creation.
   * @property options.folderPath - The path within the repository where the document will be created. If not provided, the default location may be used.
   *
   * @returns Promise resolving to the created document object with its metadata and other relevant details.
   */
  createDocument(
    repositoryId,
    name,
    content,
    options = { versioningState: 'major' },
  ) {
    const { cmisProperties, config = {}, ...optionalParameters } = options;

    const allCmisProperties = convertObjectToCmisProperties({
      'cmis:name': name,
      'cmis:objectTypeId': 'cmis:document',
      ...(cmisProperties || {}),
    });

    const bodyData = {
      cmisaction: 'createDocument',
      ...allCmisProperties,
      ...this.globalParameters,
      ...optionalParameters,
    };

    const requestBody = jsonToFormdata(bodyData);
    if (content) requestBody.append('content', content, name);

    let request;
    if (!options?.folderPath) {
      request = builder.createBrowserRootByRepositoryId(
        repositoryId,
        requestBody,
      );
    } else {
      request = builder.createBrowserRootByRepositoryIdAndDirectoryPath(
        repositoryId,
        options.folderPath,
        requestBody,
      );
    }

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
