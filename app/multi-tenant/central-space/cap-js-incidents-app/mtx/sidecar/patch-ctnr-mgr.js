/**
 * Patches a null-safety bug in @sap/cds-mtxs ctnr-mgr-base.js.
 *
 * Buggy line (v3.x and v4.x):
 *   _pollError = (response) => response.data.errors[0] ?? response.data.errors
 *
 * When Service Manager returns a failed operation without an errors array,
 * response.data.errors is undefined and [0] throws:
 *   TypeError: Cannot read properties of undefined (reading '0')
 * This crashes the process and leaves a stuck HDI instance in Service Manager
 * on every subscription attempt.
 *
 * Fix: use optional chaining so a missing errors array returns undefined
 * instead of throwing, and cds-mtxs handles it as a generic error.
 */
const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'node_modules/@sap/cds-mtxs/srv/plugins/hana/ctnr-mgr-base.js');

try {
  let content = fs.readFileSync(filePath, 'utf8');

  const buggy = '_pollError = (response) => response.data.errors[0] ?? response.data.errors';
  const fixed = '_pollError = (response) => response.data?.errors?.[0] ?? response.data?.errors';

  if (!content.includes(buggy)) {
    console.log('[patch-ctnr-mgr] Pattern not found — already patched or version changed, skipping.');
    process.exit(0);
  }

  content = content.replace(buggy, fixed);
  fs.writeFileSync(filePath, content, 'utf8');
  console.log('[patch-ctnr-mgr] Successfully patched ctnr-mgr-base.js.');
} catch (e) {
  console.warn('[patch-ctnr-mgr] Could not patch ctnr-mgr-base.js:', e.message);
}
