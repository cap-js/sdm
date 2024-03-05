const FormData = require('form-data');

/**
 * Converts a JSON object into a FormData object.
 *
 * Given a JSON object, this function iterates over its properties and appends
 * each key-value pair to a new FormData object. The values are converted to string
 * before appending to ensure compatibility with the FormData API.
 *
 * Example:
 *
 * Input:
 * { "username": "John", "age": 25 }
 *
 * Output:
 * FormData { "username" => "John", "age" => "25" }
 *
 * @param data - The JSON object to be transformed into FormData.
 * @returns A new FormData object containing the data from the input object.
 */
module.exports = function convertJsonToFormData(data) {
  const formData = new FormData();

  Object.entries(data).forEach(([key, value]) => {
    value && formData.append(key, value.toString());
  });

  return formData;
};
