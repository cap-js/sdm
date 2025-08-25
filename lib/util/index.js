const xssec = require("@sap/xssec");
const cds = require("@sap/cds");
const requests = xssec.v3.requests;
const NodeCache = require("node-cache");
const cache = new NodeCache();
const { sdmAnnotationAdditionalpropertyName, sdmAnnotationAdditionalproperty } = require("./messageConsts");

async function fetchAccessToken(credentials, jwt) {
  let decoded_token_jwt = decodeAccessToken(jwt);
   let subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
    let cache_key = decoded_token_jwt.email+"_"+subdomain;
  let access_token = cache.get(cache_key); // to check if token exists
  if (access_token === undefined) {
    access_token = await generateSDMBearerToken(credentials, jwt);
    let user = decodeAccessToken(access_token).email;
     let subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
     let cache_key = user+"_"+subdomain;
    cache.set(cache_key, access_token, 11 * 3600); //expires after 11 hours
  } else {
    let decoded_token = decodeAccessToken(access_token);
    if (isTokenExpired(decoded_token.exp)) {
      access_token = generateSDMBearerToken(credentials, jwt);
       let subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
       let cache_key = decoded_token.email+"_"+subdomain;
      cache.del(cache_key);
      cache.set(cache_key, access_token, 11 * 3600); //expires after 11 hours
    }

  }
  return access_token;
}
async function generateSDMBearerToken(credentials, jwt) {
 let subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
  return new Promise(function (resolve, reject) {
    requests.requestUserToken(
      jwt,
      credentials.uaa,
      null, null, subdomain, null, (error, response) => {
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
function isTokenExpired(exp) {
  const expiry = new Date(exp * 1000);
  const now = new Date();
  return now > expiry;
}

function isRepositoryVersioned(repoInfo, repositoryId) {
  let repoType = repoInfo.data[repositoryId].capabilities["capabilityContentStreamUpdatability"]
  if (repoType === "pwconly") {
    repoType = "versioned";
  } else {
    repoType = "non-versioned";
  }
  saveRepoToCache(repositoryId, repoType);
  return repoType === "versioned" ? true : false;
}

function saveRepoToCache(repositoryId, type) {
   let subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
  const repoType = cache.get(repositoryId+"_"+subdomain);
  if (repoType === undefined) {
    cache.set((repositoryId+"_"+subdomain), type, 60 * 60 * 24 * 60);
  }
}

function decodeAccessToken(jwtEncoded) {
  const jwtBase64Encoded = jwtEncoded.split('.')[1];
  const jwtDecodedAsString = Buffer.from(jwtBase64Encoded, 'base64').toString('ascii');
  return JSON.parse(jwtDecodedAsString);
}

async function getClientCredentialsToken(credentials) {
  let subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
  const access_token = cache.get("SDM_ACCESS_TOKEN_"+subdomain); // to check if token exists
  if (access_token === undefined) {
    return new Promise(function (resolve, reject) {
      requests.requestClientCredentialsToken(
        subdomain,
        credentials.uaa,
        null,
        (error, response) => {
          if (error) {
            console.error(
              `Response error while fetching access token ${response.statusCode}`
            );
            reject(err);
          } else {
            cache.set("SDM_ACCESS_TOKEN_"+subdomain, response, 11*3600); //expires after 11 hours
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
// Check if the environment variable is present
    const repositoryId = process.env.REPOSITORY_ID;
    if (repositoryId) {
        return { repositoryId: repositoryId };
    } else {
        // If not present, return settings from cds.env.requires["sdm"]
        return cds.env.requires?.["sdm"]?.settings || {};
    }
}

function isRestrictedCharactersInName(filename) {
  const regex = /[/\\]/;
  return regex.test(filename);
}

function getStatusCondition(statusCode) {
  if (statusCode === 404) {
    return "don't";
  } else if (statusCode === 409) {
    return "already";
  }
}

function getPropertyTitles(attachmentEntity, attachment) {
  const titleMap = {};

  if (!attachmentEntity) {
    return titleMap;
  }

  const entity = attachmentEntity;
  for (const key of Object.keys(attachment)) {
    const element = entity.elements[key];
    // Skip if the element is undefined
    if (!element) {
      continue;
    }

    const propertyName = element[sdmAnnotationAdditionalpropertyName] ? element[sdmAnnotationAdditionalpropertyName] : null;
    // Use the title annotation if available, otherwise fallback to the element name
    const title = element['@title'] ? element['@title'] : element.name;

    if (propertyName && title) {
      titleMap[propertyName] = title;
    }
  }

  return titleMap;
}

//Identify incorrectly defined properties in the CDS file to group them with unsupported ones where "MCM" is not true.
function getSecondaryPropertiesWithInvalidDefinition(attachmentEntity, attachment) {
  const invalidProperties = {};

  if (!attachmentEntity) {
    return invalidProperties;
  }

  const keysList = Object.keys(attachment);

  for (const key of keysList) {

    const element = attachmentEntity.elements[key];
    if (element) {
      // Checking the outdated/old SDM Annotation
      const sdmAnnotation = element[sdmAnnotationAdditionalproperty];
      if (sdmAnnotation) {
        const titleAnnotation = element['@title'];
        const title = titleAnnotation ? titleAnnotation : element.name; // Fallback to element name if title is not defined
        invalidProperties[key] = title;
      }
    }
  }

  return invalidProperties;
}

function getSecondaryTypeProperties(attachmentEntity, attachment) {
  const keysList = Object.keys(attachment);
  const secondaryTypeProperties = new Map();
  
  if (attachmentEntity) {
    keysList.forEach((key) => {
      const element = attachmentEntity.elements[key];
      if (element) {
        // Check if the element has the new SDM annotation for additional properties
        const nameAnnotation = element[sdmAnnotationAdditionalpropertyName];

        if (nameAnnotation) {
          secondaryTypeProperties.set(element.name, nameAnnotation);
        }
      }
    });
  }

  return secondaryTypeProperties;
}

//Get updated secondary properties by comparing the current attachment values with the database values.
function getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB) {
  const updatedSecondaryProperties = {};

  // Compare the current values with the database values
  for (const [property, key] of secondaryTypeProperties.entries()) {
    const currentValue = attachment[property];
    const dbValue = propertiesInDB[key];

    if ((currentValue == null && dbValue != null) || 
      (currentValue != null && currentValue.toString() != dbValue)) { 
      updatedSecondaryProperties[key] = currentValue != null ? currentValue.toString() : null;
    }
  }

  return updatedSecondaryProperties;
}

//Extracts secondary type IDs from a JSON array and adds them to the result list.
function extractSecondaryTypeIds(jsonArray, result) {
  for (const jsonObject of jsonArray) {
    // Extract and store the type ID if it exists
    if (jsonObject.type && jsonObject.type.id) {
      const secondaryType = jsonObject.type.id;
      result.push(secondaryType);
    }
  
    // If this object has children, recursively process them
    if (jsonObject.children) {
      extractSecondaryTypeIds(jsonObject.children, result);
    }
  }
}

//Checks if the response contains valid secondary properties and updates the list.
function checkMCM(responseBody, secondaryPropertyIds) {
  let flag = false;

  if (!responseBody || responseBody.trim() === "") {
    return flag;
  }

  const jsonObject = JSON.parse(responseBody);

  if (!Object.hasOwn(jsonObject, "propertyDefinitions")) {
    return flag;
  }

  const propertyDefinitions = jsonObject.propertyDefinitions;

  if (!propertyDefinitions) {
    return flag;
  }

  for (const key in propertyDefinitions) {
    if (Object.hasOwn(propertyDefinitions, key)) {
      const property = propertyDefinitions[key];
      const miscellaneous = property?.["mcm:miscellaneous"];
    
      if (miscellaneous && miscellaneous.isPartOfTable === "true") {
        secondaryPropertyIds.push(key);
        flag = true;
      }
    }
  }

  return flag;
}

//Prepares secondary properties and adds them to the FormData object.
function prepareSecondaryProperties(formData, secondaryProperties) {
  let index = 1;

  for (const [key, value] of Object.entries(secondaryProperties)) {
    if (key === "filename") {
      formData.append(`propertyId[${index}]`, "cmis:name");
      formData.append(`propertyValue[${index}]`, value);
    } else {
      formData.append(`propertyId[${index}]`, key);
      formData.append(`propertyValue[${index}]`, value);
    }
    index++;
  }
}

module.exports = {
  fetchAccessToken,
  getConfigurations,
  isRepositoryVersioned,
  getClientCredentialsToken,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties,
  extractSecondaryTypeIds,
  checkMCM,
  prepareSecondaryProperties
};
