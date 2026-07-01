/**
 * Patches null-safety bugs in @sap/cds-mtxs (present in v3.x and v4.x).
 *
 * Bug 1 — ctnr-mgr-base.js _pollError:
 *   response.data.errors[0] crashes when SM returns a failed operation without an errors array.
 *
 * Bug 2 — srv-mgr.js create() catch block:
 *   Multiple accesses to `e` (e.status, e.error, e.code, etc.) crash when the caught value
 *   is undefined — which happens when _poll resolves/rejects with no error object.
 *   Fix: add a single guard at the top of the catch block.
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

// Bug 2: srv-mgr.js — catch block accesses e.status, e.error, etc. but e can be undefined.
// Guard the entire catch block with a single early check instead of patching each access.
patch(
  path.join(__dirname, 'node_modules/@sap/cds-mtxs/srv/plugins/hana/srv-mgr.js'),
  `      } catch (e) {
        this.instanceLocations.delete(tenant)
        const status = e.status ?? 500`,
  `      } catch (e) {
        this.instanceLocations.delete(tenant)
        if (!e) throw new Error('HDI container creation failed with no error details from Service Manager')
        const status = e.status ?? 500`,
  'srv-mgr.js create() catch block guard'
);
