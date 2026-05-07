'use strict';

const path = require('path');
const credentials = require('./credentials.json');
const { run, runAndCaptureAll } = require('./utills/shell-script-runner');

const SCRIPTS_DIR = path.join(__dirname, 'utills');
const SUBSCRIBE_SCRIPT = path.join(SCRIPTS_DIR, 'cf-subscribe.sh');
const UNSUBSCRIBE_SCRIPT = path.join(SCRIPTS_DIR, 'cf-unsubscribe.sh');
const REPO_MANAGE_SCRIPT = path.join(SCRIPTS_DIR, 'sdm-repo-manage.sh');
const CF_LOGS_SCRIPT = path.join(SCRIPTS_DIR, 'cf-logs.sh');

const SUBSCRIPTION_REPO_EXTERNAL_ID = credentials.SUBSCRIPTION_REPO_EXTERNAL_ID || 'MULTITENANT-TEST-REPO';
const MT_APP_NAME = credentials.MT_APP_NAME;
const consumerSubdomain = credentials.CONSUMER_SUBDOMAIN;

// Helper: check if a repo exists in consumer scope
async function repoCheck(externalId) {
  return runAndCaptureAll(REPO_MANAGE_SCRIPT, 'check', '--externalId', externalId, '--subdomain', consumerSubdomain);
}

// Helper: onboard a repo in consumer scope
async function repoOnboard(externalId) {
  return run(REPO_MANAGE_SCRIPT, 'onboard', '--externalId', externalId, '--subdomain', consumerSubdomain);
}

// Helper: offboard a repo in consumer scope
async function repoOffboard(externalId) {
  return runAndCaptureAll(REPO_MANAGE_SCRIPT, 'offboard', '--externalId', externalId, '--subdomain', consumerSubdomain);
}

// Helper: check if a repo exists in provider scope (no --subdomain)
async function repoCheckProviderScope(externalId) {
  return runAndCaptureAll(REPO_MANAGE_SCRIPT, 'check', '--externalId', externalId);
}

// Helper: onboard a repo in provider scope (no --subdomain)
async function repoOnboardProviderScope(externalId) {
  return run(REPO_MANAGE_SCRIPT, 'onboard', '--externalId', externalId);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

beforeAll(async () => {
  expect(consumerSubdomain).toBeTruthy();

  // Ensure subscription is active before tests run
  console.log('BeforeAll: Ensuring app is subscribed...');
  const subscribeExit = await run(SUBSCRIBE_SCRIPT);
  expect(subscribeExit).toBe(0);
  await sleep(15000);

  // Verify repo exists after subscription
  const repoResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(repoResult.exitCode).toBe(0);
  console.log('BeforeAll: Subscription active and repo verified.');
}, 120000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Create Subscription with existing repo → onboarding skipped
// ─────────────────────────────────────────────────────────────────────────────
test('(1) Subscribe when repo already exists — expect onboarding skipped', async () => {
  console.log('Test (1): Subscribe when repo already exists — expect graceful handling');

  // Pre-condition: repo should exist from beforeAll setup
  console.log('  Verifying repo exists from setup subscription...');
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(checkResult.exitCode).toBe(0);

  // Unsubscribe but leave repo in place (repo persists after unsubscribe since
  // it was onboarded; we only need the subscription itself removed)
  console.log('  Unsubscribing (repo stays in SDM instance)...');
  await run(UNSUBSCRIBE_SCRIPT);
  await sleep(15000);

  // Manually re-onboard the repo in consumer scope if the unsubscribe offboarded it
  const reCheck = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  if (reCheck.exitCode !== 0) {
    console.log('  Repo was offboarded by unsubscribe — re-onboarding for precondition...');
    const onboardExit = await repoOnboard(SUBSCRIPTION_REPO_EXTERNAL_ID);
    expect(onboardExit).toBe(0);
    await sleep(5000);
  }

  // Act: Subscribe again — app should detect repo already exists and skip onboarding
  console.log('  Re-subscribing...');
  const subscribeResult = await runAndCaptureAll(SUBSCRIBE_SCRIPT);
  expect(subscribeResult.exitCode).toBe(0);
  await sleep(15000);

  // Verify via CF logs that onboarding was skipped
  console.log('  Fetching CF logs to verify onboarding was skipped...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME);
  const skipped = logResult.containsIgnoreCase('already exist')
    || logResult.containsIgnoreCase('skipped')
    || logResult.containsIgnoreCase('Already subscribed')
    || logResult.containsIgnoreCase('Subscription is active');
  expect(skipped).toBe(true);

  // Repo should still exist
  const verifyResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(verifyResult.exitCode).toBe(0);
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Delete subscription with multiple repos → only correct repo offboarded
// ─────────────────────────────────────────────────────────────────────────────
test('(2) Unsubscribe with multiple repos — only correct repo should be offboarded', async () => {
  console.log('Test (2): Unsubscribe with multiple repos — only correct repo should be offboarded');

  const otherRepo = credentials.repo1;
  expect(otherRepo).toBeTruthy();

  // Ensure subscription is active
  const subscribeExit = await run(SUBSCRIBE_SCRIPT);
  if (subscribeExit !== 0) {
    await sleep(30000);
    const retryExit = await run(SUBSCRIBE_SCRIPT);
    expect(retryExit).toBe(0);
  }
  await sleep(15000);

  // Ensure a second repo exists in provider scope (not tied to consumer subscription)
  const checkOther = await repoCheckProviderScope(otherRepo);
  if (checkOther.exitCode !== 0) {
    console.log(`  Onboarding other repo '${otherRepo}' in provider scope...`);
    const onboardExit = await repoOnboardProviderScope(otherRepo);
    expect(onboardExit).toBe(0);
  }

  // Act: Unsubscribe
  console.log('  Unsubscribing...');
  const unsubscribeExit = await run(UNSUBSCRIBE_SCRIPT);
  expect(unsubscribeExit).toBe(0);

  // Allow time for async offboarding
  await sleep(15000);

  // Verify offboard via CF logs
  console.log('  Fetching CF logs to verify repo offboard...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME);
  const offboarded = logResult.containsIgnoreCase('Offboarded')
    || logResult.containsIgnoreCase('offboard');
  expect(offboarded).toBe(true);

  // Verify: The other repo (provider scope) should still exist
  const verifyOther = await repoCheckProviderScope(otherRepo);
  expect(verifyOther.exitCode).toBe(0);
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Delete subscription with only correct repo → repo offboarded
// ─────────────────────────────────────────────────────────────────────────────
test('(3) Unsubscribe with only the subscription repo — expect repo offboarded', async () => {
  console.log('Test (3): Unsubscribe with only the subscription repo — expect repo offboarded');

  // Wait for previous unsubscribe to fully complete
  await sleep(30000);

  // Subscribe to set up precondition
  console.log('  Subscribing to set up precondition...');
  let subscribeExit = await run(SUBSCRIBE_SCRIPT);
  if (subscribeExit !== 0) {
    console.log(`  First subscribe attempt failed (exit ${subscribeExit}) — retrying after 30s...`);
    await sleep(30000);
    subscribeExit = await run(SUBSCRIBE_SCRIPT);
  }
  expect(subscribeExit).toBe(0);

  // Wait for repo to be onboarded
  await sleep(15000);

  // Verify precondition — repo exists in consumer scope
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(checkResult.exitCode).toBe(0);

  // Act: Unsubscribe
  console.log('  Unsubscribing...');
  const unsubscribeExit = await run(UNSUBSCRIBE_SCRIPT);
  expect(unsubscribeExit).toBe(0);

  // Allow time for offboarding
  await sleep(15000);

  // Verify offboard via CF logs
  console.log('  Fetching CF logs to verify repo offboard...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME);
  const offboarded = logResult.containsIgnoreCase('Offboarded')
    || logResult.containsIgnoreCase('offboard');
  expect(offboarded).toBe(true);
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Delete subscription when repo doesn't exist → logs indicate 404
// ─────────────────────────────────────────────────────────────────────────────
test('(4) Unsubscribe when repo does not exist — expect logs to indicate 404 from DI', async () => {
  console.log('Test (4): Unsubscribe when repo does not exist — expect logs to indicate 404');

  // Wait for previous unsubscribe to fully complete
  await sleep(30000);

  // Subscribe
  console.log('  Subscribing...');
  let subscribeExit = await run(SUBSCRIBE_SCRIPT);
  if (subscribeExit !== 0) {
    console.log(`  First subscribe attempt failed (exit ${subscribeExit}) — retrying after 30s...`);
    await sleep(30000);
    subscribeExit = await run(SUBSCRIBE_SCRIPT);
  }
  expect(subscribeExit).toBe(0);

  // Wait for subscription callback to complete
  await sleep(15000);

  // Verify repo was onboarded
  console.log('  Verifying repo was onboarded after subscription...');
  const repoResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(repoResult.exitCode).toBe(0);

  // Manually offboard the repo so it doesn't exist when we unsubscribe
  console.log('  Manually offboarding repo to set up precondition...');
  const offboardResult = await repoOffboard(SUBSCRIPTION_REPO_EXTERNAL_ID);
  if (offboardResult.exitCode === 0) {
    console.log('  Repo offboarded successfully.');
  } else {
    console.log(`  Repo was already not present (exit code: ${offboardResult.exitCode})`);
  }

  // Verify precondition — repo should NOT exist
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(checkResult.exitCode).toBe(1);

  // Act: Unsubscribe (the app will try to offboard a non-existent repo)
  console.log('  Unsubscribing...');
  const unsubscribeExit = await run(UNSUBSCRIBE_SCRIPT);
  expect(unsubscribeExit).toBe(0);

  // Allow time for unsubscribe callback to process
  await sleep(15000);

  // Verify: Check CF logs for 404 indication from DI/SDM
  console.log('  Fetching CF logs to verify 404 handling...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME);
  const has404 = logResult.containsIgnoreCase('not found')
    || logResult.containsIgnoreCase('Repository with ID')
    || logResult.containsIgnoreCase('404')
    || logResult.containsIgnoreCase('does not exist');
  expect(has404).toBe(true);
}, 180000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Create Subscription without existing repo → repo gets onboarded
// (Runs last so the system remains in a subscribed state after all tests)
// ─────────────────────────────────────────────────────────────────────────────
test('(5) Subscribe without existing repo — expect repo to be onboarded', async () => {
  console.log('Test (5): Subscribe without existing repo — expect repo to be onboarded');

  // Wait for previous unsubscribe to fully complete
  await sleep(30000);

  // Pre-condition: ensure the repo does NOT exist (offboard if present)
  console.log('  Ensuring repo does not exist...');
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  if (checkResult.exitCode === 0) {
    console.log('  Repo exists — offboarding to set up precondition...');
    const offResult = await repoOffboard(SUBSCRIPTION_REPO_EXTERNAL_ID);
    expect(offResult.exitCode).toBe(0);
  }

  // Also ensure NOT subscribed
  console.log('  Ensuring consumer is unsubscribed...');
  await run(UNSUBSCRIBE_SCRIPT);
  await sleep(15000);

  // Act: Subscribe
  console.log('  Subscribing...');
  const subscribeExit = await run(SUBSCRIBE_SCRIPT);
  expect(subscribeExit).toBe(0);

  // Allow time for async repo onboarding
  await sleep(15000);

  // Verify: repo should now exist
  console.log('  Verifying repo was onboarded...');
  const verifyResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(verifyResult.exitCode).toBe(0);
  expect(verifyResult.containsIgnoreCase('FOUND')).toBe(true);
}, 180000);
