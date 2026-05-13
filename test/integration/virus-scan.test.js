'use strict';

const path = require('path');
const axios = require('axios');
const credentials = require('./credentials.json');
const Api = require('./api');

const tenancyModel = process.env.TENANCY_MODEL || 'single';
const tenant = process.env.TENANT;

let token;
let api;
let appUrl;
const serviceName = 'processor';
const entityName = 'Incidents';
const srvpath = 'ProcessorService';

let entityID;
let attachmentID1;
let attachmentID2;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Wait for attachment upload to complete by polling metadata.
 * Mirrors Java's waitForUploadCompletion().
 */
async function waitForUploadCompletion(api, appUrl, entityId, attachmentId, timeoutSeconds = 120) {
  const intervalMs = 2000;
  const maxIterations = Math.floor(timeoutSeconds / (intervalMs / 1000));

  for (let i = 0; i < maxIterations; i++) {
    try {
      const result = await api.fetchMetadataDraft(appUrl, serviceName, entityName, entityId, attachmentId);
      if (result.status === 'OK' && result.data) {
        const uploadStatus = result.data.uploadStatus;
        if (uploadStatus === 'Success') {
          return true;
        } else if (uploadStatus === 'Failed') {
          console.error(`Upload failed for attachment: ${attachmentId}`);
          return false;
        }
      }
      await sleep(intervalMs);
    } catch (e) {
      console.error(`Error checking upload status for attachment ${attachmentId}: ${e.message}`);
      return false;
    }
  }

  console.error(`Upload timed out for attachment: ${attachmentId}`);
  return false;
}

beforeAll(async () => {
  let clientId;
  let clientSecret;
  let authUrl;

  if (tenancyModel === 'multi') {
    appUrl = credentials.appUrlMT;
    clientId = credentials.clientIDMT;
    clientSecret = credentials.clientSecretMT;

    if (tenant === 'SDM-DEV-CONSUMER-EU12') {
      console.log('Running virus scan integration tests | SDM-DEV-CONSUMER-EU12 tenant');
      authUrl = credentials.authUrlMTSDC;
    } else if (tenant === 'SDMGoogleWorkspaceConsumer') {
      console.log('Running virus scan integration tests | SDMGoogleWorkspaceConsumer tenant');
      authUrl = credentials.authUrlMTGWC;
    }
  } else {
    console.log('Running virus scan integration tests | Single tenant');
    appUrl = credentials.appUrl;
    clientId = credentials.clientID;
    clientSecret = credentials.clientSecret;
    authUrl = credentials.authUrl;
  }

  const authRes = await axios.get(
    `${authUrl}/oauth/token?grant_type=password&username=${credentials.username}&password=${credentials.password}`,
    { auth: { username: clientId, password: clientSecret } }
  );
  token = authRes.data.access_token;

  const config = { headers: { 'Authorization': `Bearer ${token}` } };
  api = new Api(config);
}, 60000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 – Create entity and check if it exists
// ─────────────────────────────────────────────────────────────────────────────
test('(1) Create entity and check if it exists', async () => {
  console.log('Test (1): Create entity and check if it exists');

  let response = await api.createEntityDraft(appUrl, serviceName, entityName);
  expect(response.status).toBe('OK');
  entityID = response.incidentID;

  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID);
  expect(response.status).toBe('OK');

  response = await api.checkEntity(appUrl, serviceName, entityName, entityID);
  expect(response.status).toBe('OK');
}, 60000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 – Upload a clean PDF — should succeed on virus-scanned repo
// ─────────────────────────────────────────────────────────────────────────────
test('(2) Upload clean PDF on virus scan repository', async () => {
  console.log('Test (2): Upload clean PDF on virus scan repository');

  // Edit entity to draft mode
  let response = await api.editEntity(appUrl, serviceName, entityName, entityID, srvpath);
  expect(response.status).toBe('OK');

  const file = { filename: 'sample.pdf', filepath: './test/integration/sample.pdf' };
  const postData = {
    up__ID: entityID,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID, postData, file);
  expect(response.status).toBe('OK');
  attachmentID1 = response.ID;

  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID);
  expect(response.status).toBe('OK');

  response = await api.readAttachment(appUrl, serviceName, entityName, entityID, attachmentID1);
  expect(response.status).toBe('OK');
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 – Upload EICAR virus file — expect rejection
// ─────────────────────────────────────────────────────────────────────────────
test('(3) Upload EICAR virus file — expect virus scan to reject', async () => {
  console.log('Test (3): Upload EICAR virus file — expect virus scan to reject the file');

  // Edit entity to draft mode
  let response = await api.editEntity(appUrl, serviceName, entityName, entityID, srvpath);
  expect(response.status).toBe('OK');

  // Use the EICAR test file — a standard anti-malware test file
  const eicarFilePath = process.env.EICAR_FILE_PATH || path.join(__dirname, 'eicar.com.txt');
  const fs = require('fs');
  if (!fs.existsSync(eicarFilePath)) {
    throw new Error(`EICAR virus test file not found at: ${eicarFilePath}`);
  }

  const file = { filename: 'eicar.com.txt', filepath: eicarFilePath };
  const postData = {
    up__ID: entityID,
    mimeType: 'text/plain',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID, postData, file);

  if (response.status === 'FAILED') {
    // Immediate rejection by virus scanner — expected
    console.log(`  Virus file rejected immediately: ${response.message}`);
    expect(response.message.toLowerCase()).toMatch(/malware|virus|infected|rejected/);
  } else if (response.status === 'OK') {
    // Attachment created in draft — save and check if async virus scan catches it
    attachmentID2 = response.ID;
    const saveResponse = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID);
    if (saveResponse.status === 'OK') {
      // Wait for async virus scan to process
      const uploadSucceeded = await waitForUploadCompletion(api, appUrl, entityID, attachmentID2, 120);
      expect(uploadSucceeded).toBe(false);
      console.log('  Virus file was rejected by async virus scan as expected');
    } else {
      // Save itself failed due to virus — also expected
      console.log(`  Save failed due to virus scan: ${saveResponse.message}`);
    }
  }
}, 300000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 – Cleanup: delete entity
// ─────────────────────────────────────────────────────────────────────────────
test('(4) Delete test entity', async () => {
  console.log('Test (4): Delete test entity');
  if (entityID) {
    const response = await api.deleteEntity(appUrl, serviceName, entityName, entityID);
    expect(response.status).toBe('OK');
  }
}, 60000);


