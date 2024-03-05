/**
 * Converts an input object into its corresponding CMIS Property/Value format.
 *
 * Given an input object with key-value pairs, this function will convert each pair
 * into the CMIS properties format. For simple key-value pairs, keys are represented
 * as `propertyId[index]` and values as `propertyValue[index]`. For keys associated with
 * an array of values, each value in the array gets its own `propertyValue[index][subIndex]`.
 *
 * Example:
 *
 * Input:
 * {
 *   "cmis:name": "Document",
 *   "cmis:tags": ["tag1", "tag2"]
 * }
 *
 * Output:
 * {
 *   "propertyId[0]": "cmis:name",
 *   "propertyValue[0]": "Document",
 *   "propertyId[1]": "sap:tags",
 *   "propertyValue[1][0]": "tag1",
 *   "propertyValue[1][1]": "tag2"
 * }
 *
 * @param input - The input object with key-value pairs (or key-array pairs) to be transformed.
 * @returns The transformed object in CMIS properties format.
 */

module.exports = function convertObjectToCmisProperties(input) {
  console.log('input -------');
  console.log(JSON.stringify(input));
  const result = {};
  let idx = 0;

  for (const [key, value] of Object.entries(input)) {
    result[`propertyId[${idx}]`] = key;

    if (Array.isArray(value)) {
      value.forEach((v, subIdx) => {
        result[`propertyValue[${idx}][${subIdx}]`] = v;
      });
    } else {
      result[`propertyValue[${idx}]`] = value;
    }

    idx++;
  }

  return result;
};
