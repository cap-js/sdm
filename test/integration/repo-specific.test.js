'use strict';

const path = require('path');
const axios = require('axios');
const credentials = require('./credentials.json');
const Api = require('./api');
const { run } = require('./utills/shell-script-runner');

const SCRIPTS_DIR = path.join(__dirname, 'utills');
const UPDATE_ENV_SCRIPT = path.join(SCRIPTS_DIR, 'cf-update-env.sh');

const repo1 = credentials.repo1;
const repo2 = credentials.repo2;
const defaultRepositoryID = credentials.defaultRepositoryID;

let token;
let api;
let appUrl;
const serviceName = 'processor';
const entityName = 'Incidents';
const srvpath = 'ProcessorService';

// Entity/attachment IDs used across tests
let entityID1;
let attachmentID1;
let entityID_rename;
let entityID_upv;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function switchRepo(repoId) {
  const exitCode = await run(UPDATE_ENV_SCRIPT, '--value', repoId);
  if (exitCode !== 0) {
    throw new Error(`cf-update-env.sh failed with exit code ${exitCode} for repo ${repoId}`);
  }
  // Allow time for restage to complete
  await sleep(5000);
}

async function getActiveAttachmentsList(entityId) {
  const response = await axios.get(
    `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${entityId},IsActiveEntity=true)/references`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  return response.data.value || [];
}

beforeAll(async () => {
  expect(repo1).toBeTruthy();
  expect(repo2).toBeTruthy();
  expect(defaultRepositoryID).toBeTruthy();

  console.log('Running repo-specific integration tests | Single tenant');
  appUrl = credentials.appUrl;
  const clientId = credentials.clientID;
  const clientSecret = credentials.clientSecret;
  const authUrl = credentials.authUrl;

  // Get token
  const authRes = await axios.get(
    `${authUrl}/oauth/token?grant_type=password&username=${credentials.username}&password=${credentials.password}`,
    { auth: { username: clientId, password: clientSecret } }
  );
  token = authRes.data.access_token;

  const config = { headers: { 'Authorization': `Bearer ${token}` } };
  api = new Api(config);
}, 60000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 – Setup: Switch to repo1, create entity, upload attachment
// ─────────────────────────────────────────────────────────────────────────────
test('(1) Setup — switch to repo1, create entity with attachment', async () => {
  console.log(`Test (1): Setup — switch to repo1 (${repo1}), create entity with attachment`);

  // Switch to repo1
  await switchRepo(repo1);

  // Create entity
  let response = await api.createEntityDraft(appUrl, serviceName, entityName);
  expect(response.status).toBe('OK');
  entityID1 = response.incidentID;

  // Upload attachment (sample.pdf) under repo1
  const file = { filename: 'sample.pdf', filepath: './test/integration/sample.pdf' };
  const postData = {
    up__ID: entityID1,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID1, postData, file);
  expect(response.status).toBe('OK');
  attachmentID1 = response.ID;

  // Save the entity
  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID1);
  expect(response.status).toBe('OK');

  // Verify attachment is readable
  response = await api.readAttachment(appUrl, serviceName, entityName, entityID1, attachmentID1);
  expect(response.status).toBe('OK');

  // Verify attachment count is 1
  const attachments = await getActiveAttachmentsList(entityID1);
  expect(attachments.length).toBe(1);
  console.log(`  Setup complete: entity ${entityID1} with attachment ${attachmentID1}`);
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 – Switch to repo2, verify previous attachments are not visible
// ─────────────────────────────────────────────────────────────────────────────
test('(2) Switch to repo2 — attachments from repo1 are not visible', async () => {
  console.log(`Test (2): Switch to repo2 (${repo2}), verify attachments from repo1 are not visible`);

  // Switch to repo2
  await switchRepo(repo2);

  // Entity should still exist but have 0 attachments
  let response = await api.checkEntity(appUrl, serviceName, entityName, entityID1);
  expect(response.status).toBe('OK');

  const attachments = await getActiveAttachmentsList(entityID1);
  expect(attachments.length).toBe(0);
  console.log(`  Verified: entity ${entityID1} has no attachments visible under repo2`);
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 – Duplicate attachment name across repos (create)
// ─────────────────────────────────────────────────────────────────────────────
test('(3) Create attachment with same name under repo2 — should succeed', async () => {
  console.log('Test (3): Create attachment with same name (sample.pdf) under repo2 — should succeed');

  // Still on repo2 from previous test
  // Edit entity to draft
  let response = await api.editEntity(appUrl, serviceName, entityName, entityID1, srvpath);
  expect(response.status).toBe('OK');

  // Upload same file name (sample.pdf) under repo2
  const file = { filename: 'sample.pdf', filepath: './test/integration/sample.pdf' };
  const postData = {
    up__ID: entityID1,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID1, postData, file);
  expect(response.status).toBe('OK');

  // Save
  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID1);
  expect(response.status).toBe('OK');
  console.log('  Duplicate attachment (sample.pdf) created successfully under repo2');
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 – Duplicate attachment name via rename across repos
// ─────────────────────────────────────────────────────────────────────────────
test('(4) Rename attachment to duplicate name across repos — should succeed', async () => {
  console.log('Test (4): Create entity with sample.pdf in repo1, switch to repo2, upload sample.txt, rename to sample.pdf');

  // Switch to repo1 to create a fresh entity with sample.pdf
  await switchRepo(repo1);

  // Create a new entity under repo1
  let response = await api.createEntityDraft(appUrl, serviceName, entityName);
  expect(response.status).toBe('OK');
  entityID_rename = response.incidentID;

  // Upload sample.pdf under repo1
  const pdfFile = { filename: 'sample.pdf', filepath: './test/integration/sample.pdf' };
  const postData1 = {
    up__ID: entityID_rename,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID_rename, postData1, pdfFile);
  expect(response.status).toBe('OK');

  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID_rename);
  expect(response.status).toBe('OK');

  // Switch to repo2
  await switchRepo(repo2);

  // Edit entity and upload sample.txt, then rename to sample.pdf
  response = await api.editEntity(appUrl, serviceName, entityName, entityID_rename, srvpath);
  expect(response.status).toBe('OK');

  const txtFile = { filename: 'sample.txt', filepath: './test/integration/sample.txt' };
  const postData2 = {
    up__ID: entityID_rename,
    mimeType: 'text/plain',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID_rename, postData2, txtFile);
  expect(response.status).toBe('OK');
  const attachmentID2 = response.ID;

  // Rename sample.txt to sample.pdf (same name as attachment in repo1 — not in repo2)
  response = await api.updateAttachment(appUrl, serviceName, entityName, entityID_rename, { filename: 'sample.pdf' }, attachmentID2);
  expect(response.status).toBe('OK');

  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID_rename);
  expect(response.status).toBe('OK');
  console.log('  Renamed sample.txt to sample.pdf under repo2 — success');
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 – Verify user-provided REPOSITORY_ID variable works
// ─────────────────────────────────────────────────────────────────────────────
test('(5) Upload documents under different repos via user-provided variable — both should exist', async () => {
  console.log('Test (5): Verify REPOSITORY_ID user-provided variable works across repos');

  // Switch to repo1 and create entity with attachment
  await switchRepo(repo1);

  let response = await api.createEntityDraft(appUrl, serviceName, entityName);
  expect(response.status).toBe('OK');
  entityID_upv = response.incidentID;

  const file1 = { filename: 'repo1-file.pdf', filepath: './test/integration/sample.pdf' };
  const postData1 = {
    up__ID: entityID_upv,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID_upv, postData1, file1);
  expect(response.status).toBe('OK');
  const repo1AttachmentID = response.ID;

  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID_upv);
  expect(response.status).toBe('OK');

  // Verify attachment readable under repo1
  response = await api.readAttachment(appUrl, serviceName, entityName, entityID_upv, repo1AttachmentID);
  expect(response.status).toBe('OK');

  // Switch to repo2 and upload another attachment on the same entity
  await switchRepo(repo2);

  response = await api.editEntity(appUrl, serviceName, entityName, entityID_upv, srvpath);
  expect(response.status).toBe('OK');

  const file2 = { filename: 'repo2-file.pdf', filepath: './test/integration/sample.pdf' };
  const postData2 = {
    up__ID: entityID_upv,
    mimeType: 'application/pdf',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, entityID_upv, postData2, file2);
  expect(response.status).toBe('OK');
  const repo2AttachmentID = response.ID;

  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, entityID_upv);
  expect(response.status).toBe('OK');

  // Verify: under repo2, only the repo2 attachment should be visible
  let attachments = await getActiveAttachmentsList(entityID_upv);
  expect(attachments.length).toBe(1);
  expect(attachments[0].ID).toBe(repo2AttachmentID);

  // Switch back to repo1 and verify repo1 attachment is visible
  await switchRepo(repo1);
  attachments = await getActiveAttachmentsList(entityID_upv);
  expect(attachments.length).toBe(1);
  expect(attachments[0].ID).toBe(repo1AttachmentID);

  console.log('  Both documents exist in their respective repositories');
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 – Create attachment with non-existent repository ID → error
// ─────────────────────────────────────────────────────────────────────────────
test('(6) Create attachment with non-existent repo — should fail with repo info error', async () => {
  const fakeRepoId = `non-existent-repo-${Date.now()}`;
  console.log(`Test (6): Switch to non-existent repo (${fakeRepoId}) and attempt attachment creation — expect failure`);

  // Switch to a random non-existent repository ID
  await switchRepo(fakeRepoId);

  // Create entity (draft creation should still succeed)
  let response = await api.createEntityDraft(appUrl, serviceName, entityName);
  expect(response.status).toBe('OK');
  const bookId = response.incidentID;

  // Upload an attachment
  const file = { filename: 'sample.txt', filepath: './test/integration/sample.txt' };
  const postData = {
    up__ID: bookId,
    mimeType: 'text/plain',
    createdAt: new Date().toISOString(),
    createdBy: 'test@test.com',
    modifiedBy: 'test@test.com'
  };

  response = await api.createAttachment(appUrl, serviceName, entityName, bookId, postData, file);

  // Save the entity — this should fail because the repo doesn't exist
  response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, bookId);
  expect(response.status).not.toBe('OK');
  const errorMsg = (response.message || '').toLowerCase();
  expect(
    errorMsg.includes('failed to get repository info') ||
    errorMsg.includes('repository') ||
    errorMsg.includes('error')
  ).toBe(true);
  console.log(`  Expected error received: ${response.message}`);
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup – Revert REPOSITORY_ID back to default
// ─────────────────────────────────────────────────────────────────────────────
afterAll(async () => {
  console.log(`Reverting REPOSITORY_ID to default: ${defaultRepositoryID}`);
  await switchRepo(defaultRepositoryID);
}, 60000);
