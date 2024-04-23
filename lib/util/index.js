const xssec = require("@sap/xssec");
const cds = require("@sap/cds");
const requests = xssec.requests;


function fetchAccessToken(credentials){
    return new Promise(function (resolve, reject) {
      requests.requestClientCredentialsToken(
        null,
        credentials.uaa,
        null,
        (error, response) => {
          if (error) {
            console.error(
              `Response error while fetching access token ${response.statusCode}`
            );
            reject(err);
          } else {
            resolve(response);
          }
        }
      );
    });
}

function getConfigurations() {
  return cds.env.requires?.['attachments']?.settings || {};
}

module.exports = {
  fetchAccessToken,
  getConfigurations,
};
