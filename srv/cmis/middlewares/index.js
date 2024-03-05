const convertJsonToFormData = require('../converters/json-to-formdata');

const jsonToFormData = options => {
  return request => {
    request.data = convertJsonToFormData(request.data);
    return options.fn(request);
  };
};

module.exports = {
  jsonToFormData,
};
