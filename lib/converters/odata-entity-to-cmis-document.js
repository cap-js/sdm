const { getColumnsMapping } = require('../util');

/**
 * Converts a CMIS document structure to OData format based on the provided elements mapping.
 *
 * @param {Object} data - OData entity data
 * @param {Object} elements - The OData properties
 * @returns {Promise<Array<Object>>} An array of data transformed into OData format.
 */
module.exports = function convertODataToCMISDocument(data, elements) {
  const columnsMapping = getColumnsMapping(elements);
  console.log('columnsMapping -------');
  console.log(JSON.stringify(columnsMapping));
  return Object.entries(data).reduce((acc, [key, value]) => {
    if (columnsMapping[key]) {
      acc[columnsMapping[key].path] = value;
    }
    return acc;
  }, {});
};
