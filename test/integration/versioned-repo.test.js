'use strict';

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

beforeAll(async () => {
  let clientId;
  let clientSecret;
  let authUrl;

  if (tenancyModel === 'multi') {
    appUrl = credentials.appUrlMT;
    clientId = credentials.clientIDMT;
    clientSecret = credentials.clientSecretMT;

    if (tenant === 'SDM-DEV-CONSUMER-EU12') {
      console.log('Running versioned repository integration tests | SDM-DEV-CONSUMER-EU12 tenant');
      authUrl = credentials.authUrlMTSDC;
    } else if (tenant === 'SDMGoogleWorkspaceConsumer') {
      console.log('Running versioned repository integration tests | SDMGoogleWorkspaceConsumer tenant');
      authUrl = credentials.authUrlMTGWC;
    }
  } else {
    console.log('Running versioned repository integration tests | Single tenant');
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
// Test 1 – Create entity and upload attachment — should fail on versioned repo
// ─────────────────────────────────────────────────────────────────────────────
test('(1) Upload attachment on versioned repository — expect error', async () => {
  console.log('Test (1): Create entity and upload attachment on versioned repository — expect error');

  // Create entity
  let response = await api.createEntityDraft(appUrl, serviceName, entityName);
  if (response.status !== 'OK') {
    console.log(`  Create entity failed: ${response.message}`);
  }
  expect(response.status).toBe('OK');
  entityID = response.incidentID;

  // Upload attachment
  const file = { filename: 'sample.pdf', filepath: './test/integration/sample.pdf' };
  const postData = {
    up__ID: entityID,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID, postData, file);

  if (response.status === 'OK') {
    // Attachment was created in draft — save should fail on versioned repository
    const saveResponse = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID);
    expect(saveResponse.status).toBe('FAILED');
    console.log(`  Save failed as expected: ${saveResponse.message}`);
  } else {
    // Operation itself failed — expected on versioned repo
    console.log(`  Operation failed as expected: ${response.message}`);
    expect(response.message.toLowerCase()).toMatch(/error|fail|version/);
  }
}, 180000);
