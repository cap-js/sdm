const cds = require('@sap/cds');

const getConfigurations = () => {
  return cds.env.requires?.['@cap-js/document-management']?.settings || {};
};

module.exports = { getConfigurations };
