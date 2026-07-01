/**
 * Patches two null-safety bugs in @sap/cds-mtxs (present in v3.x and v4.x):
 *
 * Bug 1 — ctnr-mgr-base.js _pollError:
 *   response.data.errors[0] crashes when SM returns a failed operation without an errors array.
 *   Fix: use optional chaining.
 *
 * Bug 2 — srv-mgr.js create():
 *   `const status = e.status ?? 500` crashes with "Cannot read properties of undefined
 *   (reading 'status')" when the caught error `e` is itself undefined (SM returned a
 *   sync 200/no Location header so _poll resolved instead of rejecting, and the
 *   resulting throw propagates as undefined).
 *   Fix: guard `e` before reading .status.
 */
const fs = require('fs');
const path = require('path');

function patch(filePath, buggy, fixed, label) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    if (!content.includes(buggy)) {
      console.log(`[patch-ctnr-mgr] ${label}: pattern not found — already patched or version changed, skipping.`);
      return;
    }
    content = content.replace(buggy, fixed);
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[patch-ctnr-mgr] ${label}: patched successfully.`);
  } catch (e) {
    console.warn(`[patch-ctnr-mgr] ${label}: could not patch:`, e.message);
  }
}

// Bug 1: ctnr-mgr-base.js — _pollError reads .errors[0] without null guard
patch(
  path.join(__dirname, 'node_modules/@sap/cds-mtxs/srv/plugins/hana/ctnr-mgr-base.js'),
  '_pollError = (response) => response.data.errors[0] ?? response.data.errors',
  '_pollError = (response) => response.data?.errors?.[0] ?? response.data?.errors',
  'ctnr-mgr-base.js _pollError'
);

// Bug 2: srv-mgr.js create() — `e` can be undefined when caught from _poll
patch(
  path.join(__dirname, 'node_modules/@sap/cds-mtxs/srv/plugins/hana/srv-mgr.js'),
  'const status = e.status ?? 500',
  'const status = e?.status ?? 500',
  'srv-mgr.js create() status'
);
