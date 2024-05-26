const xssec = require("@sap/xssec");
const cds = require("@sap/cds");
const requests = xssec.requests;
const NodeCache = require("node-cache");
const cache = new NodeCache();
async function fetchAccessToken(credentials,jwt) {
  let access_token = cache.get("SDM_ACCESS_TOKEN"); // to check if token exists
  if (access_token === undefined) {
    access_token = await generateSDMBearerToken(credentials,jwt);
    cache.set("SDM_ACCESS_TOKEN", access_token, 11); //expires after 11 hours
  } else {
    if(isTokenExpired(access_token)){
access_token = generateSDMBearerToken(credentials,jwt);
cache.set("SDM_ACCESS_TOKEN", access_token, 11); //expires after 11 hours
    }

  }
  return access_token;
}
async function generateSDMBearerToken(credentials,jwt){
return new Promise(function (resolve, reject) {
  requests.requestUserToken(
         jwt,
         credentials.uaa,
         null, null, null, null, (error, response)=>{
       if (error) {
         console.error(
           `Response error while fetching access token ${response.statusCode}`
         );
         reject(err);
       } else {
       console.log("TOKEN EXCHANGE "+response);
         resolve(response);
       }
     }
   );
 });
}
function isTokenExpired(jwtEncoded){
  const jwtBase64Encoded = jwtEncoded.split('.')[1]
  const jwtDecodedAsString = Buffer.from(jwtBase64Encoded, 'base64').toString('ascii')
  const jwtDecodedJson = JSON.parse(jwtDecodedAsString)
  var expiry = new Date(jwtDecodedJson.exp * 1000);
  var now = new Date();
 return now>expiry;
}

function getConfigurations() {
  return cds.env.requires?.["attachments-sdm"]?.settings || {};
}

module.exports = {
  fetchAccessToken,
  getConfigurations,
};
