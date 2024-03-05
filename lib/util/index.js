const { getDestination } = require('@sap-cloud-sdk/core');
const { getConfigurations } = require('../config');

const extractPluginPropertiesFromElement = element => {
  const sdmField = {};
  for (const [key, value] of Object.entries(element)) {
    if (key.startsWith('@Sdm.Field.')) {
      const propName = key.split('.').pop().replace(':', '');
      sdmField[propName] = value;
    }
  }

  return Object.keys(sdmField).length ? sdmField : null;
};

const getColumnsMapping = elements => {
  return Object.values(elements).reduce((acc, e) => {
    const sdmField = extractPluginPropertiesFromElement(e);
    if (sdmField?.type === 'property') {
      acc[e.name] = sdmField;
    }
    return acc;
  }, {});
};

/**
 * Generates a URL based on the given SDM field and query.
 * @param {Object} sdmField - The SDM field data.
 * @param {Object} query - The CMIS query data.
 * @returns {string} The generated URL.
 */
const generateUrlFromField = (repositoryId, sdmField, query) => {
  const { path: contentStreamId } = sdmField;
  const { 'cmis:objectId': objectId } = query.succinctProperties;
  let url = `/browser/${repositoryId}/root?cmisselector=content&objectId=${objectId}`;
  if (contentStreamId) {
    url += `&streamId=${contentStreamId}`;
  }
  return url;
};

const loadDestination = async (req, options = { useCache: false }) => {
  const { destination: destinationName } = getConfigurations();
  const userJwt =
    typeof req?._req?.tokenInfo?.getTokenValue === 'function'
      ? req?._req?.tokenInfo?.getTokenValue()
      : undefined;

  const opt = userJwt ? { ...options, userJwt } : options;
  return await getDestination(destinationName, opt);
};

module.exports = {
  extractPluginPropertiesFromElement,
  getColumnsMapping,
  generateUrlFromField,
  loadDestination
};
