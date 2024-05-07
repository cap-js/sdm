const { read } = require("@sap/cds/lib");
const { getConfigurations } = require("../util");
const axios = require("axios").default;

async function readAttachment(Key,token,credentials) {
  try {
    const document = await readDocument(Key,token,credentials.uri)
    console.log(document,"doc")
    return document
  } catch (error) {
    console.error(error);
    throw new Error(error);
  }
}

async function readDocument(Key, token, uri){
  const { repositoryId } = getConfigurations();
  const documentReadURL = uri+ "browser/" + repositoryId + "/root?objectID=" + Key + "&cmisselector=content"; 
  console.log('Check url: ', documentReadURL);
  const config = {
    headers: {Authorization: `Bearer ${token}`},
    responseType: 'arraybuffer'
  };

  try {
    const response = await axios.get(documentReadURL, config);
    const responseBuffer = Buffer.from(response.data, 'binary');
    return responseBuffer;
  } catch (error) {
    console.error(error);
    let statusText = "An Error Occurred"; 
    if (error.response && error.response.statusText) {
      statusText = error.response.statusText;
    }

    throw new Error(statusText);
  }
}

module.exports = {
  readAttachment,
  readDocument
};
