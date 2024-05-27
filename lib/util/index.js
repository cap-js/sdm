const xssec = require("@sap/xssec");
const cds = require("@sap/cds");
const requests = xssec.requests;
const NodeCache = require("node-cache");
const cache = new NodeCache();
async function fetchAccessToken(credentials,jwt) {
  let access_token = cache.get("SDM_ACCESS_TOKEN"); // to check if token exists
  if (access_token === undefined) {
    access_token = await generateSDMBearerToken(credentials,jwt);
    let user = decodeAccessToken(access_token).email;
    cache.set(user, access_token, 11 * 3600); //expires after 11 hours
  } else {
   let decoded_token = decodeAccessToken(jwtEncoded);
    if(isTokenExpired(decoded_token.exp)){
access_token = generateSDMBearerToken(credentials,jwt);
cache.del(decoded_token.email);
cache.set(decoded_token.email, access_token, 11 * 3600); //expires after 11 hours
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
         resolve(response);
         return response;
       }
     }
   );
 });
}
function isTokenExpired(exp){

  var expiry = new Date(exp * 1000);
  var now = new Date();
 return now>expiry;
}
function decodeAccessToken(jwtEncoded){
const jwtBase64Encoded = jwtEncoded.split('.')[1];
  const jwtDecodedAsString = Buffer.from(jwtBase64Encoded, 'base64').toString('ascii');
  return JSON.parse(jwtDecodedAsString);
}

function getConfigurations() {
  return cds.env.requires?.["attachments-sdm"]?.settings || {};
}

module.exports = {
  fetchAccessToken,
  getConfigurations,
};
