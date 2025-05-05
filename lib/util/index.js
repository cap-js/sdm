const { XsuaaService } = require("@sap/xssec");
const { XssecError, ValidationError, NetworkError } = require("@sap/xssec").errors;
const cds = require("@sap/cds");
const NodeCache = require("node-cache");
const cache = new NodeCache();

const {
  getExistingAttachments
} = require("../persistence");

async function fetchAccessToken(credentials, jwt) {
  try {
    const decodedTokenJwt = decodeAccessToken(jwt);
    const subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
    const cacheKey = decodedTokenJwt.email + "_" + subdomain;
    let accessToken = cache.get(cacheKey);

    if (!accessToken || isTokenExpired(decodeAccessToken(accessToken).exp)) {
      accessToken = await generateSDMBearerToken(credentials, jwt);
      cache.set(cacheKey, accessToken, 11 * 3600); //expires after 11 hours
    }
    return accessToken;
  } catch (error) {
    if (error instanceof ValidationError) {
      console.error("Validation Error:", error.message);
    } else if (error instanceof NetworkError) {
      console.error("Network Error:", error.message);
    } else if (error instanceof XssecError) {
      console.error("Xssec Error:", error.message);
    } else {
      console.error("Error:", error.message);
    }
    throw error;
  }
}

async function generateSDMBearerToken(credentials, jwt) {
  const subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
  const authService = new XsuaaService(credentials);
  try {
    const response = await authService.fetchJwtBearerToken(jwt, { subdomain });
    return response.access_token;
  } catch (error) {
    console.error(`Error fetching SDM bearer token: ${error.message}`);
    throw error;
  }
}

function isTokenExpired(exp) {
  const expiry = new Date(exp * 1000);
  const now = new Date();
  return now > expiry;
}

function isRepositoryVersioned(repoInfo, repositoryId) {
  let repoType = repoInfo.data[repositoryId].capabilities["capabilityContentStreamUpdatability"];
  repoType = repoType === "pwconly" ? "versioned" : "non-versioned";
  saveRepoToCache(repositoryId, repoType);
  return repoType === "versioned";
}

function saveRepoToCache(repositoryId, type) {
  const subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
  const repoType = cache.get(repositoryId + "_" + subdomain);
  if (repoType === undefined) {
    cache.set(repositoryId + "_" + subdomain, type, 60 * 60 * 24 * 60); // Cache for 60 days
  }
}

function decodeAccessToken(jwtEncoded) {
  const jwtBase64Encoded = jwtEncoded.split('.')[1];
  const jwtDecodedAsString = Buffer.from(jwtBase64Encoded, 'base64').toString('ascii');
  return JSON.parse(jwtDecodedAsString);
}

async function getClientCredentialsToken(credentials) {
  const subdomain = cds.context.user?.tokenInfo?.getPayload()?.ext_attr?.zdn;
  const cachedToken = cache.get("SDM_ACCESS_TOKEN_" + subdomain);
  if (!cachedToken) {
    const authService = new XsuaaService(credentials);
    try {
      const response = await authService.fetchClientCredentialsToken({ subdomain });
      cache.set("SDM_ACCESS_TOKEN_" + subdomain, response.access_token, 11 * 3600);
      return response.access_token;
    } catch (error) {
      console.error(`Error fetching client credentials token: ${error.message}`);
      throw error;
    }
  }
  return cachedToken;
}

function getConfigurations() {
  const repositoryId = process.env.REPOSITORY_ID;
  if (repositoryId) {
    return { repositoryId: repositoryId };
  } else {
    return cds.env.requires?.["sdm"]?.settings || {};
  }
}

async function checkAttachmentsToRename(attachmentValRename, attachmentIDs, attachments) {
  let modifiedAttachments = [];
  if (attachmentValRename.length > 0) {
    const matchedAttachments = await getExistingAttachments(attachmentIDs, attachments);
    attachmentValRename.forEach(draftAttachment => {
      const correspondingAttachment = matchedAttachments.find(attachment => attachment.ID === draftAttachment.ID);
      if (correspondingAttachment && correspondingAttachment.filename !== draftAttachment.filename) {
        modifiedAttachments.push({
          ID: draftAttachment.ID,
          url: draftAttachment.url,
          name: draftAttachment.filename,
          prevname: correspondingAttachment.filename,
          folderId: correspondingAttachment.folderId
        });
      }
    });
  }
  return modifiedAttachments;
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

module.exports = {
  fetchAccessToken,
  getConfigurations,
  checkAttachmentsToRename,
  isRepositoryVersioned,
  getClientCredentialsToken,
  isRestrictedCharactersInName,
  getStatusCondition
};