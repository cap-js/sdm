'use strict';

const path = require('path');
const axios = require('axios');
const credentials = require('./credentials.json');
const Api = require('./api');
const { run } = require('./utills/shell-script-runner');

const SCRIPTS_DIR = path.join(__dirname, 'utills');
const UPDATE_ENV_SCRIPT = path.join(SCRIPTS_DIR, 'cf-update-env.sh');

const versionedRepositoryID = credentials.versionedRepositoryID;
const defaultRepositoryID = credentials.defaultRepositoryID;

let token;
let api;
let appUrl;
const serviceName = 'processor';
const entityName = 'Incidents';
const srvpath = 'ProcessorService';

let entityID;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function switchRepo(repoId) {
  const exitCode = await run(UPDATE_ENV_SCRIPT, '--value', repoId);
  if (exitCode !== 0) {
    throw new Error(`cf-update-env.sh failed with exit code ${exitCode} for repo ${repoId}`);
  }
  await sleep(5000);
}

beforeAll(async () => {
  expect(versionedRepositoryID).toBeTruthy();
  expect(defaultRepositoryID).toBeTruthy();

  console.log('Running versioned repository integration tests | Single tenant');
  appUrl = credentials.appUrl;
  const clientId = credentials.clientID;
  const clientSecret = credentials.clientSecret;
  const authUrl = credentials.authUrl;

  const authRes = await axios.get(
    `${authUrl}/oauth/token?grant_type=password&username=${credentials.username}&password=${credentials.password}`,
    { auth: { username: clientId, password: clientSecret } }
  );
  token = authRes.data.access_token;

  const config = { headers: { 'Authorization': `Bearer ${token}` } };
  api = new Api(config);
}, 60000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 – Switch to versioned repository
// ─────────────────────────────────────────────────────────────────────────────
test('(1) Change REPOSITORY_ID to versioned repository', async () => {
  console.log(`Test (1): Change REPOSITORY_ID to versioned repository: ${versionedRepositoryID}`);
  await switchRepo(versionedRepositoryID);
}, 120000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 – Create entity and upload attachment — should fail on versioned repo
// ─────────────────────────────────────────────────────────────────────────────
test('(2) Upload attachment on versioned repository — expect error', async () => {
  console.log('Test (2): Create entity and upload attachment on versioned repository — expect error');

  // Create entity
  let response = await api.createEntityDraft(appUrl, serviceName, entityName);
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

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 – Revert REPOSITORY_ID back to default
// ─────────────────────────────────────────────────────────────────────────────
test('(3) Revert REPOSITORY_ID to default repository', async () => {
  console.log(`Test (3): Revert REPOSITORY_ID to default repository: ${defaultRepositoryID}`);
  await switchRepo(defaultRepositoryID);
}, 120000);
