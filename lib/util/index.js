const xssec = require("@sap/xssec");
const cds = require("@sap/cds");
const requests = xssec.v3.requests;
const NodeCache = require("node-cache");
const { sdmAnnotationAdditionalpropertyName, sdmAnnotationAdditionalproperty } = require("./messageConsts");
const cache = new NodeCache();
const { jwtBearerToken, serviceToken,decodeJwt } = require('@sap-cloud-sdk/connectivity');




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

//function decodeJwt(token) {
//  try {
//    const base64Url = token.split('.')[1];
//    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
//    const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
//      return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
//    }).join(''));
//    return JSON.parse(jsonPayload);
//  } catch (error) {
//    console.error('Error decoding JWT:', error);
//    return {};
//  }
//}

function buildOAuth2JWTBearerDestination(token, url, name) {
  const expirationTime = decodeJwt(token).exp;
  const expiresIn = expirationTime
    ? Math.floor((expirationTime * 1000 - Date.now()) / 1000).toString(10)
    : undefined;
  return {
    url,
    name,
    authentication: 'OAuth2JWTBearer',
    authTokens: [
      {
        value: token,
        type: 'bearer',
        expiresIn,
        http_header: {
          key: 'Authorization',
          value: `Bearer ${token}`
        },
        error: null
      }
    ]
  };
}

async function transformSDMServiceBindingToJWTBearerCredentialsDestination(service, options, userJwt) {
  const transformedService = {
    ...service,
    credentials: { ...service.credentials.uaa }
  };

  const token = await jwtBearerToken(userJwt, transformedService);
  return buildOAuth2JWTBearerDestination(
    token,
    service.credentials.uaa.url,
    service.name
  );
}

async function transformSDMServiceBindingToClientCredentialsDestination(service, options, technicalJwt) {
  const transformedService = {
    ...service,
    credentials: { ...service.credentials.uaa }
  };

  const token = await serviceToken(transformedService, options);
  return buildClientCredentialsDestination(
    token,
    service.credentials.uaa.url,
    service.name
  );
}

function buildClientCredentialsDestination(token, url, name) {
  const expirationTime = decodeJwt(token).exp;
  const expiresIn = expirationTime
    ? Math.floor((expirationTime * 1000 - Date.now()) / 1000).toString(10)
    : undefined;
  return {
    url,
    name,
    authentication: 'OAuth2ClientCredentials',
    authTokens: [
      {
        value: token,
        type: 'bearer',
        expiresIn,
        http_header: {
          key: 'Authorization',
          value: `Bearer ${token}`
        },
        error: null
      }
    ]
  };
}

function getSdmInstanceName() {
  var data = process.env.VCAP_SERVICES;
  let sdmInstanceName = null;
  let jsonData = JSON.parse(data);
  if (jsonData.sdm && jsonData.sdm.length > 0) {
    sdmInstanceName = jsonData.sdm[0].name;
  }
  return sdmInstanceName;
}

module.exports = {
  getConfigurations,
  isRepositoryVersioned,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties,
  extractSecondaryTypeIds,
  checkMCM,
  prepareSecondaryProperties,
  transformSDMServiceBindingToJWTBearerCredentialsDestination,
  transformSDMServiceBindingToClientCredentialsDestination,
  getSdmInstanceName
};
