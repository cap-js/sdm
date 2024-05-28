const xssec = require("@sap/xssec");
const cds = require("@sap/cds");
const requests = xssec.requests;
const NodeCache = require("node-cache");
const cache = new NodeCache();

function fetchAccessToken(credentials) {
  const access_token = cache.get("SDM_ACCESS_TOKEN"); // to check if token exists
  if (access_token === undefined) {
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
            cache.set("SDM_ACCESS_TOKEN", response, 11); //expires after 11 hours
            resolve(response);
          }
        }
      );
    });
  } else {
    return access_token;
  }
}

function getConfigurations() {
  return cds.env.requires?.["sdm"]?.settings || {};
}

module.exports = {
  fetchAccessToken,
  getConfigurations,
};
