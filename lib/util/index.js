const cds = require("@sap/cds");
const NodeCache = require("node-cache");
const { sdmAnnotationAdditionalpropertyName, sdmAnnotationAdditionalproperty, sdmAnnotationUseClientCredential } = require("./messageConsts");
const cache = new NodeCache();
const { jwtBearerToken, serviceToken, decodeJwt } = require('@sap-cloud-sdk/connectivity');

const LOG = cds.log('sdm', cds.env);

function isRepositoryVersioned(repoInfo, repositoryId) {
  let repoType = repoInfo.data[repositoryId].capabilities["capabilityContentStreamUpdatability"]
  if (repoType === "pwconly") {
    repoType = "versioned";
  } else {
    repoType = "non-versioned";
  }
  saveRepoToCache(repositoryId, repoType);
  LOG.debug(`[DEBUG] [isRepositoryVersioned] repositoryId=${repositoryId} type=${repoType}`);
  return repoType === "versioned" ? true : false;
}

function saveRepoToCache(repositoryId, type) {
  let subdomain = cds.context?.user?.authInfo?.token?.payload?.ext_attr?.zdn;
  const repoType = cache.get(repositoryId + "_" + subdomain);
  if (repoType === undefined) {
    cache.set((repositoryId + "_" + subdomain), type, 60 * 60 * 24 * 60);
  }
}
function getConfigurations() {
  // Check if the environment variable is present
  const repositoryId = process.env.REPOSITORY_ID;
  if (repositoryId) {
    LOG.debug(`[DEBUG] [getConfigurations] Using REPOSITORY_ID env var: ${repositoryId}`);
    return { repositoryId: repositoryId };
  } else {
    const settings = cds.env.requires?.["sdm"]?.settings || {};
    LOG.debug(`[DEBUG] [getConfigurations] Using cds.env settings repositoryId=${settings.repositoryId}`);
    return settings;
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
      if (value != null) {
        formData.append(`propertyValue[${index}]`, value);
      } else if (key === "cmis:description") {
        formData.append(`propertyValue[${index}]`, "");
      }
    }
    index++;
  }
}

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
  // Extract tenant subdomain and replace provider subdomain in UAA URL for multi-tenant support
  let uaaUrl = service.credentials.uaa.url;
  const subdomain = cds.context?.user?.authInfo?.token?.payload?.ext_attr?.zdn;
  LOG.debug(`[DEBUG] [transformJWTBearerDestination] subdomain=${subdomain} service=${service.name}`);
  if (subdomain && uaaUrl.includes('://')) {
    const providerSubdomain = uaaUrl.substring(uaaUrl.indexOf('://') + 3, uaaUrl.indexOf('.'));
    uaaUrl = uaaUrl.replace(providerSubdomain, subdomain);
  }
  const transformedService = {
    ...service,
    credentials: {
      ...service.credentials.uaa,
      url: uaaUrl
    }
  };
  const token = await jwtBearerToken(userJwt, transformedService, options);
  LOG.info(`[INFO] [transformJWTBearerDestination] Token acquired for service=${service.name}`);
  return buildOAuth2JWTBearerDestination(
    token,
    uaaUrl,
    service.name
  );
}
async function transformSDMServiceBindingToClientCredentialsDestination(service, options, subdomain) {
  // Extract tenant subdomain and replace provider subdomain in UAA URL for multi-tenant support
  let uaaUrl = service.credentials.uaa.url;
  if (!subdomain)
    subdomain = cds.context?.user?.authInfo?.token?.payload?.ext_attr?.zdn;
  LOG.debug(`[DEBUG] [transformClientCredentialsDestination] subdomain=${subdomain} service=${service.name}`);
  if (subdomain && uaaUrl.includes('://')) {
    const providerSubdomain = uaaUrl.substring(uaaUrl.indexOf('://') + 3, uaaUrl.indexOf('.'));
    uaaUrl = uaaUrl.replace(providerSubdomain, subdomain);
  }
  const transformedService = {
    ...service,
    credentials: {
      ...service.credentials.uaa,
      url: uaaUrl
    }
  };

  const token = await serviceToken(transformedService, {  ...options,jwt: { ext_attr: { zdn: subdomain } }});
  LOG.info(`[INFO] [transformClientCredentialsDestination] Token acquired for service=${service.name}`);
  return buildClientCredentialsDestination(
    token,
    uaaUrl,
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

/**
 * Determine byte-length of upload content before reading the stream.
 * Returns -1 when size cannot be determined (triggers single-chunk path as safe fallback).
 */
function getContentLength(content) {
  if (!content) return -1;
  if (Buffer.isBuffer(content)) return content.length;
  // Readable stream with a known buffered length
  if (typeof content.readableLength === 'number' && content.readableLength > 0) {
    return content.readableLength;
  }
  // Objects that carry an explicit size (e.g. form-data file descriptors)
  if (typeof content === 'object' && typeof content.size === 'number') {
    return content.size;
  }
  return -1;
}

// Cache for parsed VCAP_SERVICES. VCAP_SERVICES is set once at process start and
// never changes at runtime, but the two getters below are called multiple times
// per request — without caching, each call re-runs JSON.parse on a multi-KB
// blob. We key the cache on the raw env-var string so any (test-time) reassignment
// invalidates it automatically.
let _vcapCache = { raw: undefined, parsed: undefined };
function _getVcapServices() {
  const data = process.env.VCAP_SERVICES;
  if (_vcapCache.raw === data) return _vcapCache.parsed;
  let parsed = null;
  if (data) {
    try {
      parsed = JSON.parse(data);
    } catch {
      parsed = null;
    }
  }
  _vcapCache = { raw: data, parsed };
  return parsed;
}

function getSdmInstanceName() {
  const jsonData = _getVcapServices();
  if (jsonData?.sdm && jsonData.sdm.length > 0) {
    LOG.debug(`[DEBUG] [getSdmInstanceName] Found SDM instance: ${jsonData.sdm[0].name}`);
    return jsonData.sdm[0].name;
  }
  LOG.warn('[WARN] [getSdmInstanceName] No SDM service instance found in VCAP_SERVICES');
  return null;
}

// Returns the SDM service binding's UAA clientid — i.e. the technical user that
// DMS/DI sees when @SDM.useClientCredential is in effect. Used to keep the
// plugin DB's createdBy/modifiedBy aligned with the actual SDM principal.
function getSdmClientId() {
  const jsonData = _getVcapServices();
  if (jsonData?.sdm && jsonData.sdm.length > 0) {
    return jsonData.sdm[0].credentials?.uaa?.clientid || null;
  }
  return null;
}

function isClientCredentialForced(req, attachmentsEntity) {
  // Explicit entity wins — caller knows which composition it's working with,
  // so per-composition selection is honored even when the parent has multiple
  // attachment compositions with different annotations.
  if (attachmentsEntity) {
    const forced = attachmentsEntity[sdmAnnotationUseClientCredential] === true;
    LOG.debug(`[DEBUG] [isClientCredentialForced] entity=${attachmentsEntity.name} forced=${forced}`);
    return forced;
  }
  // Direct attachment-target call (e.g. CREATE on Incidents.references).
  if (req.target?.[sdmAnnotationUseClientCredential] === true) {
    LOG.debug(`[DEBUG] [isClientCredentialForced] target=${req.target.name} forced=true`);
    return true;
  }
  // Parent-entity fallback (rename / SAVE handlers that haven't been threaded
  // with the explicit entity): scan attachment compositions on req.target.
  const elements = req.target?.elements;
  if (elements) {
    for (const element of Object.values(elements)) {
      if (element?.type === 'cds.Composition' && element.target) {
        const targetDef = cds.model.definitions[element.target];
        if (targetDef?.[sdmAnnotationUseClientCredential] === true) {
          LOG.debug(`[DEBUG] [isClientCredentialForced] composition target=${element.target} forced=true`);
          return true;
        }
      }
    }
  }
  return false;
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
  getContentLength,
  buildOAuth2JWTBearerDestination,
  transformSDMServiceBindingToJWTBearerCredentialsDestination,
  transformSDMServiceBindingToClientCredentialsDestination,
  buildClientCredentialsDestination,
  getSdmInstanceName,
  getSdmClientId,
  isClientCredentialForced
};
