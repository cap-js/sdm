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
// SDM lifecycle handlers (subscribe/unsubscribe/onboard/offboard) only register in the
// mtx-sidecar process (gated by `cds.env.profile === "mtx-sidecar"` in @cap-js/sdm's
// lib/mtx/server.js). The sidecar is a separate CF app — by convention `<base>-mtx`
// rather than the main app `<base>-srv`. Derive the sidecar name from MT_APP_NAME so
// other tests that hit the main app can keep using credentials.MT_APP_NAME unchanged.
const MT_APP_NAME = credentials.MT_APP_NAME.replace(/-srv$/, '-mtx');
const consumerSubdomain = process.env.TENANT === 'SDMGoogleWorkspaceConsumer'
  ? credentials.consumerSubdomainMT2
  : credentials.consumerSubdomainMT1;

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
// Test 1 — Subscribe when already subscribed → graceful handling
// ─────────────────────────────────────────────────────────────────────────────
test('(1) Subscribe when already subscribed — expect graceful handling', async () => {
  console.log('Test (1): Subscribe when already subscribed — expect graceful handling');

  // Pre-condition: beforeAll left us subscribed with the repo onboarded.
  console.log('  Verifying repo exists from setup subscription...');
  const checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(checkResult.exitCode).toBe(0);

  // Act: Subscribe again (should detect 'Already subscribed' and exit 0)
  console.log('  Re-subscribing...');
  const subscribeResult = await runAndCaptureAll(SUBSCRIBE_SCRIPT);
  expect(subscribeResult.exitCode).toBe(0);
  const indicatesAlreadyActive = subscribeResult.containsIgnoreCase('Already subscribed')
    || subscribeResult.containsIgnoreCase('Subscription is active');
  expect(indicatesAlreadyActive).toBe(true);

  // Verify: repo should still exist (subscription didn't break anything)
  const verifyResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
  expect(verifyResult.exitCode).toBe(0);
}, 300000);

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — Delete subscription with multiple repos → only correct repo offboarded
// ─────────────────────────────────────────────────────────────────────────────
test('(2) Unsubscribe with multiple repos — only correct repo should be offboarded', async () => {
  console.log('Test (2): Unsubscribe with multiple repos — only correct repo should be offboarded');

  const otherRepo = credentials.defaultRepositoryID;
  expect(otherRepo).toBeTruthy();
  expect(otherRepo).not.toBe(SUBSCRIPTION_REPO_EXTERNAL_ID);

  // Ensure subscription is active
  const subscribeExit = await run(SUBSCRIBE_SCRIPT);
  if (subscribeExit !== 0) {
    await sleep(30000);
    const retryExit = await run(SUBSCRIBE_SCRIPT);
    expect(retryExit).toBe(0);
  }
  await sleep(15000);

  // Verify subscription repo exists (consumer scope works while subscribed)
  console.log('  Verifying subscription repo exists after subscribe (via CMIS API)...');
  let subRepoCheck;
  for (let attempt = 1; attempt <= 3; attempt++) {
    subRepoCheck = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
    if (subRepoCheck.exitCode === 0) break;
    console.log(`  Repo not yet visible in CMIS — retrying after 10s (attempt ${attempt}/3)...`);
    await sleep(10000);
  }
  expect(subRepoCheck.exitCode).toBe(0);
  expect(subRepoCheck.containsIgnoreCase('FOUND')).toBe(true);
  console.log('  Confirmed: subscription repo exists');

  // Ensure the other repo also exists — onboard if missing, then verify
  console.log(`  Ensuring other repo '${otherRepo}' exists before unsubscribe...`);
  let otherRepoCheck = await repoCheck(otherRepo);
  if (otherRepoCheck.exitCode !== 0) {
    console.log(`  Onboarding other repo '${otherRepo}'...`);
    const onboardExit = await repoOnboard(otherRepo);
    expect(onboardExit).toBe(0);
    await sleep(5000);
    otherRepoCheck = await repoCheck(otherRepo);
  }
  expect(otherRepoCheck.exitCode).toBe(0);
  expect(otherRepoCheck.containsIgnoreCase('FOUND')).toBe(true);
  console.log(`  Confirmed: other repo '${otherRepo}' exists before unsubscribe`);

  // Act: Unsubscribe
  console.log('  Unsubscribing...');
  const unsubscribeExit = await run(UNSUBSCRIBE_SCRIPT);
  expect(unsubscribeExit).toBe(0);

  // Allow time for async offboarding
  await sleep(15000);

  // Fetch CF logs and verify the subscription repo was offboarded
  console.log('  Fetching CF logs to verify offboard event...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME, { silent: true });
  const offboarded = logResult.containsIgnoreCase('offboarded') || logResult.containsIgnoreCase('offboard');
  expect(offboarded).toBe(true);
  console.log('  Confirmed via CF logs: subscription repo offboarded');

  // Stronger assertion: the @cap-js/sdm unsubscribe handler only operates on the
  // tenant's REPOSITORY_ID (= SUBSCRIPTION_REPO_EXTERNAL_ID), so the other repo's
  // externalId should never appear in the app's logs at all.
  const otherRepoMentioned = logResult.containsIgnoreCase(otherRepo);
  expect(otherRepoMentioned).toBe(false);
  console.log(`  Confirmed via CF logs: other repo '${otherRepo}' was not touched during unsubscribe`);
}, 600000);

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

  // Verify precondition via CMIS API — repo exists in consumer scope
  console.log('  Verifying repo exists after subscribe (via CMIS API)...');
  let checkResult;
  for (let attempt = 1; attempt <= 3; attempt++) {
    checkResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
    if (checkResult.exitCode === 0) break;
    console.log(`  Repo not yet visible in CMIS — retrying after 10s (attempt ${attempt}/3)...`);
    await sleep(10000);
  }
  expect(checkResult.exitCode).toBe(0);
  expect(checkResult.containsIgnoreCase('FOUND')).toBe(true);
  console.log('  Confirmed via CMIS API: repo exists after subscribe');

  // Act: Unsubscribe
  console.log('  Unsubscribing...');
  const unsubscribeExit = await run(UNSUBSCRIBE_SCRIPT);
  expect(unsubscribeExit).toBe(0);

  // Allow time for offboarding
  await sleep(15000);

  // Verify offboard via CF logs (consumer-scope CMIS token is invalidated post-unsubscribe).
  console.log('  Fetching CF logs to verify offboarding...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME, { silent: true });
  const offboarded = logResult.containsIgnoreCase('offboarded') || logResult.containsIgnoreCase('offboard');
  expect(offboarded).toBe(true);
  console.log('  Confirmed via CF logs: repo was offboarded after unsubscribe');
}, 600000);

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

  // Verify via CMIS API: repo was onboarded after subscription
  console.log('  Verifying repo was onboarded after subscription (via CMIS API)...');
  let repoResult;
  for (let attempt = 1; attempt <= 3; attempt++) {
    repoResult = await repoCheck(SUBSCRIPTION_REPO_EXTERNAL_ID);
    if (repoResult.exitCode === 0) break;
    console.log(`  Repo not yet visible in CMIS — retrying after 10s (attempt ${attempt}/3)...`);
    await sleep(10000);
  }
  expect(repoResult.exitCode).toBe(0);
  expect(repoResult.containsIgnoreCase('FOUND')).toBe(true);
  console.log('  Confirmed via CMIS API: repo onboarded after subscription');

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

  // Verify the app logged the missing-repo case via CF logs.
  // Actual app log (lib/mtx/server.js): "SDM Plugin: Could not find a repository with externalId '<id>' for tenant <tenant>".
  console.log('  Fetching CF logs to verify 404 handling...');
  const logResult = await runAndCaptureAll(CF_LOGS_SCRIPT, '--app', MT_APP_NAME, { silent: true });
  const has404Indication = logResult.containsIgnoreCase('Could not find a repository')
    || logResult.containsIgnoreCase('could not find')
    || logResult.containsIgnoreCase('not found')
    || logResult.containsIgnoreCase('404')
    || logResult.containsIgnoreCase('does not exist');
  expect(has404Indication).toBe(true);
  console.log('  Confirmed via CF logs: app handled missing repo gracefully');
}, 600000);

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
}, 600000);
