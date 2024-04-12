const xssec = require("@sap/xssec");
const cds = require("@sap/cds");
const requests = xssec.requests;


function fetchAccessToken(credentials){
  console.log("credentials " + credentials);

  // if (cache.get("SDM_ACCESS_TOKEN") !== undefined) {
  //   return cache.get("SDM_ACCESS_TOKEN");
  // } else {
    return new Promise(function (resolve, reject) {
      requests.requestClientCredentialsToken(
        null,
        credentials.uaa,
        null,
        (error, response) => {
          if (error) {
            console.log("Response eroor" + JSON.stringify(error));
            console.error(
              `Response error while fetching access token ${response.statusCode}`
            );
            reject(err);
          } else {
            console.log("Response " + JSON.stringify(response));
            //cache.set("SDM_ACCESS_TOKEN", response, 60);
            resolve(response);
          }
        }
      );
    });
  //}
}

function getConfigurations() {
  return cds.env.requires?.['attachments']?.settings || {};
}

module.exports = {
  fetchAccessToken,
  getConfigurations,
};
