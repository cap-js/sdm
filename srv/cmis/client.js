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
    const allCmisProperties = convertObjectToCmisProperties({...cmisProperties});

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

  createDocument(repositoryId, name, content, contentStreamType) {
    const cmisProperties = {};
    cmisProperties['cmis:name'] = name;
    cmisProperties['cmis:objectTypeId'] = 'cmis:document';
    const allCmisProperties = convertObjectToCmisProperties({...cmisProperties});

    //const contentByteArray = this.binaryStringToByteArray(content);

    const bodyData = {
      cmisaction: 'createDocument',
      media: 'binary',
      ...allCmisProperties,
      ...this.globalParameters
    };
    
    console.log("ContentStreamType -----------");
    console.log(contentStreamType);
    
    const requestBody = jsonToFormdata(bodyData);
    console.log("After Json to Formdata -----------");
    console.log(JSON.stringify(requestBody));
    
    requestBody.append('filename', content, {
      filename: name,
      contentType: contentStreamType
    });

    console.log("After appending contentStream to Formdata -----------");
    console.log(JSON.stringify(requestBody));
    
    let request;
    request = builder.createBrowserRootByRepositoryId(repositoryId, requestBody);
    const config = {};
    return this._buildRequest(request, config);
  }

  // binaryStringToByteArray(binaryString) {
  //   // Remove spaces and split the binary string into an array of binary digits
  //   const binaryDigits = binaryString.replace(/\s/g, '').match(/.{1,8}/g);

  //   // Convert each group of 8 binary digits to its corresponding byte value
  //   const byteArray = binaryDigits.map(binary => parseInt(binary, 2));

  //   const uint8Array = new Uint8Array(byteArray);
  //   console.log('uint8Array -------');
  //   console.log(JSON.stringify(uint8Array));

  //   // Create a Buffer from the byte array
  //   const buffer = Buffer.from(uint8Array);

  //   // Create a Readable stream from the Buffer
  //   const stream = new Readable();
  //   stream.push(buffer);
  //   stream.push(null); // Mark the end of the stream

  //   return stream;
  // }

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
