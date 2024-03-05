const { getConfigurations } = require('../config');
const {
  extractPluginPropertiesFromElement,
  generateUrlFromField,
} = require('../util');

/**
 * Converts a CMIS document structure to OData format based on the provided elements mapping.
 *
 * @param {Array<Object>} data - An array of CMIS document structures to be converted.
 * @param {Object} elements - The OData properties
 * @returns {Promise<Array<Object>>} An array of data transformed into OData format.
 */
const convertCMISDocumentToOData = (data, elements) => {
  const cmisDocuments = Array.isArray(data) ? data : [data];

  console.log('data -------------');
  console.log(JSON.stringify(data));
  console.log('elements -------------');
  console.log(JSON.stringify(elements));
  return cmisDocuments.map(query => {
    const result = {};

    for (let [key, value] of Object.entries(elements)) {
      const sdmField = extractPluginPropertiesFromElement(value);
      if (!sdmField) continue;

      switch (sdmField?.type) {
        case 'property': {
          const newValue = query.succinctProperties[sdmField?.path];
          if (newValue) result[key] = newValue;
          break;
        }
        case 'url': {
          const { repositoryId } = getConfigurations();
          result[key] = generateUrlFromField(repositoryId, sdmField, query);
          break;
        }
      }
    }

    return result;
  });
};

module.exports = convertCMISDocumentToOData;
