'use strict';

const path = require('path');
const credentials = require('./credentials.json');
const { run, runAndCaptureAll } = require('./utills/shell-script-runner');

const SCRIPTS_DIR = path.join(__dirname, 'utills');
const SUBSCRIBE_SCRIPT = path.join(SCRIPTS_DIR, 'cf-subscribe.sh');
const UNSUBSCRIBE_SCRIPT = path.join(SCRIPTS_DIR, 'cf-unsubscribe.sh');
const REPO_MANAGE_SCRIPT = path.join(SCRIPTS_DIR, 'sdm-repo-manage.sh');
const CF_LOGS_SCRIPT = path.join(SCRIPTS_DIR, 'cf-logs.sh');

const SUBSCRIPTION_REPO_EXTERNAL_ID = credentials.defaultRepositoryIDMT || 'MULTITENANT-TEST-REPO';
const MT_APP_NAME = credentials.MT_APP_NAME;
const consumerSubdomain = credentials.consumerSubdomainMT1;

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

  // Verify repo exists after subscription; onboard if not found (retry up to 3 times)
  let repoResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  if (repoResult.exitCode !== 0) {
    console.log('BeforeAll: Repo not found — onboarding explicitly...');
    let onboarded = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`BeforeAll: Onboard attempt ${attempt}/3...`);
      const onboardExit = await repoOnboard(SUBSCRIPTION_REPO_EXTERNAL_ID);
      if (onboardExit === 0) {
        onboarded = true;
        break;
      }
      console.log(`BeforeAll: Onboard attempt ${attempt} failed — waiting 30s before retry...`);
      await sleep(30000);
    }
    expect(onboarded).toBe(true);
    await sleep(10000);
    repoResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  }
  expect(repoResult.exitCode).toBe(0);
  console.log('BeforeAll: Subscription active and repo verified.');
}, 600000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — Create Subscription with existing repo → onboarding skipped
// ─────────────────────────────────────────────────────────────────────────────
test('(1) Subscribe when repo already exists — expect onboarding skipped', async () => {
  console.log('Test (1): Subscribe when repo already exists — expect graceful handling');

  // Pre-condition: ensure the app is unsubscribed but the repo still exists in the instance.
  // Step 1: Unsubscribe (repo gets offboarded by the app during unsubscribe)
  console.log('  Unsubscribing to set up precondition...');
  await run(UNSUBSCRIBE_SCRIPT);
  await sleep(15000);

  // Step 2: Manually onboard the repo so it exists before we subscribe
  console.log('  Manually onboarding repo so it exists before subscribe...');
  const onboardExit = await repoOnboard(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(onboardExit).toBe(0);
  await sleep(5000);

  // Verify precondition: repo exists, app is unsubscribed
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(checkResult.exitCode).toBe(0);
  console.log('  Precondition met: unsubscribed, repo exists');

  // Act: Subscribe — app should detect repo already exists and skip onboarding
  console.log('  Subscribing (repo already exists — onboarding should be skipped)...');
  const subscribeResult = await runAndCaptureAll(SUBSCRIBE_SCRIPT);
  expect(subscribeResult.exitCode).toBe(0);
  await sleep(15000);

  // Verify: repo should still exist (was not re-created or removed)
  console.log('  Verifying repo still exists after subscribe...');
  const verifyResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(verifyResult.exitCode).toBe(0);
  console.log('  Confirmed: repo still exists after subscribe');

  // Verify: CF logs should indicate onboarding was skipped due to existing repo
  console.log('  Checking CF logs for onboarding-skipped indication...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME);
  const skipped = logResult.containsIgnoreCase('already exists')
    || logResult.containsIgnoreCase('skipped')
    || logResult.containsIgnoreCase('onboarding skipped')
    || logResult.containsIgnoreCase('repository exists');
  expect(skipped).toBe(true);
  console.log('  Confirmed: CF logs indicate onboarding was skipped for existing repo');
}, 300000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Delete subscription with multiple repos → only correct repo offboarded
// ─────────────────────────────────────────────────────────────────────────────
test('(2) Unsubscribe with multiple repos — only correct repo should be offboarded', async () => {
  console.log('Test (2): Unsubscribe with multiple repos — only correct repo should be offboarded');

  const otherRepo = credentials.defaultRepositoryID;
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

  // Verify: subscription repo should no longer exist in consumer scope
  console.log('  Verifying subscription repo was offboarded...');
  const repoResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  // exitCode 1 = not found (offboarded), exitCode 0 = still exists
  console.log(`  Subscription repo check: exitCode=${repoResult.exitCode}`);
  expect(repoResult.exitCode).toBe(1);

  // Verify: The other repo (provider scope) should still exist
  const verifyOther = await repoCheckProviderScope(otherRepo);
  expect(verifyOther.exitCode).toBe(0);
  console.log(`  Other repo '${otherRepo}' still exists — confirmed`);
}, 300000);

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

  // After unsubscribing, consumer-scoped token is no longer valid.
  // Verify offboard via CF logs instead of consumer-scope repoCheck.
  console.log('  Fetching CF logs to verify repo offboard...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME);
  const offboarded = logResult.containsIgnoreCase('Offboarded') || logResult.containsIgnoreCase('offboard');
  expect(offboarded).toBe(true);
  console.log('  Confirmed: CF logs indicate repo was offboarded after unsubscribe');
}, 300000);

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

  // Verify precondition — repo should NOT exist (still subscribed so consumer scope works)
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(checkResult.exitCode).toBe(1);

  // Act: Unsubscribe (the app will try to offboard a non-existent repo)
  console.log('  Unsubscribing...');
  const unsubscribeExit = await run(UNSUBSCRIBE_SCRIPT);
  expect(unsubscribeExit).toBe(0);

  // Allow time for unsubscribe callback to process
  await sleep(15000);

  // After unsubscribing, consumer-scoped token is no longer valid.
  // Verify via CF logs that the app handled missing repo gracefully (404 or not found).
  console.log('  Fetching CF logs to verify 404 handling...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME);
  const has404Indication = logResult.containsIgnoreCase('not found')
    || logResult.containsIgnoreCase('Repository with ID')
    || logResult.containsIgnoreCase('404')
    || logResult.containsIgnoreCase('does not exist');
  expect(has404Indication).toBe(true);
  console.log('  Confirmed: CF logs indicate 404/not-found when offboarding non-existent repo');
}, 300000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Create Subscription without existing repo → repo gets onboarded
// (Runs last so the system remains in a subscribed state after all tests)
// ─────────────────────────────────────────────────────────────────────────────
test('(5) Subscribe without existing repo — expect repo to be onboarded', async () => {
  console.log('Test (5): Subscribe without existing repo — expect repo to be onboarded');

  // Wait for previous unsubscribe to fully complete
  await sleep(30000);

  // Pre-condition: ensure the repo does NOT exist (offboard if present)
  // Note: consumer scope may be invalid after test (4) unsubscribed — that's OK,
  // we just need to ensure the repo isn't there.
  console.log('  Ensuring repo does not exist...');
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  if (checkResult.exitCode === 0) {
    console.log('  Repo exists — offboarding to set up precondition...');
    const offResult = await repoOffboard(SUBSCRIPTION_REPO_EXTERNAL_ID);
    if (offResult.exitCode !== 0) {
      console.log('  Offboard output:', offResult.output);
    }
    expect(offResult.exitCode).toBe(0);
  }

  // Also ensure NOT subscribed
  console.log('  Ensuring consumer is unsubscribed...');
  await run(UNSUBSCRIBE_SCRIPT);
  await sleep(15000);

  // Act: Subscribe
  console.log('  Subscribing...');
  let subscribeExit = await run(SUBSCRIBE_SCRIPT);
  if (subscribeExit !== 0) {
    console.log(`  First subscribe attempt failed (exit ${subscribeExit}) — retrying after 30s...`);
    await sleep(30000);
    subscribeExit = await run(SUBSCRIBE_SCRIPT);
  }
  expect(subscribeExit).toBe(0);

  // Allow time for async repo onboarding (retry up to 3 times with increasing wait)
  let verifyResult;
  for (let attempt = 1; attempt <= 3; attempt++) {
    await sleep(15000);
    console.log(`  Verifying repo was onboarded (attempt ${attempt}/3)...`);
    verifyResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
    if (verifyResult.exitCode === 0) break;
    console.log(`  Repo not yet available — waiting before retry...`);
  }
  expect(verifyResult.exitCode).toBe(0);
  expect(verifyResult.containsIgnoreCase('FOUND')).toBe(true);
}, 300000);
