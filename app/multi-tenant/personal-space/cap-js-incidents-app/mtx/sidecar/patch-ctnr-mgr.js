/**
 * Patches null-safety bugs in @sap/cds-mtxs (present in v3.x and v4.x).
 *
 * Root cause chain:
 *   1. SM returns a failed operation without an errors array
 *   2. _pollError returns `undefined` (both sides of ?? are undefined)
 *   3. reject(undefined) is called inside _poll
 *   4. The caller's catch(e) receives e = undefined
 *   5. Any access to e.status / e.error etc. crashes
 *
 * Bug 1 — ctnr-mgr-base.js _pollError:
 *   Must always return a proper Error. Current patch only adds optional chaining
 *   but still returns undefined when errors is absent. Fix: fall through to a
 *   meaningful Error so reject() always gets a real object.
 *
 * Bug 2 — srv-mgr.js create() catch block:
 *   Guard e before any property access as a defensive safety net.
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

// Bug 1: _pollError must always return a proper Error, never undefined.
// Original: response.data.errors[0] ?? response.data.errors
// Previous partial patch: response.data?.errors?.[0] ?? response.data?.errors
//   → still returns undefined when errors is absent → reject(undefined) → catch(e) gets undefined
// Fix: fall through to a real Error so reject() always has something to work with.
patch(
  path.join(__dirname, 'node_modules/@sap/cds-mtxs/srv/plugins/hana/ctnr-mgr-base.js'),
  '_pollError = (response) => response.data.errors[0] ?? response.data.errors',
  '_pollError = (response) => response.data?.errors?.[0] ?? response.data?.errors ?? new Error(`Service Manager operation failed with state: ${response.data?.state ?? \'unknown\'}`)',
  'ctnr-mgr-base.js _pollError'
);

// Also handle the case where the previous partial patch was already applied
patch(
  path.join(__dirname, 'node_modules/@sap/cds-mtxs/srv/plugins/hana/ctnr-mgr-base.js'),
  '_pollError = (response) => response.data?.errors?.[0] ?? response.data?.errors',
  '_pollError = (response) => response.data?.errors?.[0] ?? response.data?.errors ?? new Error(`Service Manager operation failed with state: ${response.data?.state ?? \'unknown\'}`)',
  'ctnr-mgr-base.js _pollError (already partially patched)'
);

// Bug 2: catch block guard — defensive safety net for any other undefined throw
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

// Also handle already-partially-patched variant (e?.status from previous run)
patch(
  path.join(__dirname, 'node_modules/@sap/cds-mtxs/srv/plugins/hana/srv-mgr.js'),
  `      } catch (e) {
        this.instanceLocations.delete(tenant)
        if (!e) throw new Error('HDI container creation failed with no error details from Service Manager')
        const status = e?.status ?? 500`,
  `      } catch (e) {
        this.instanceLocations.delete(tenant)
        if (!e) throw new Error('HDI container creation failed with no error details from Service Manager')
        const status = e.status ?? 500`,
  'srv-mgr.js create() catch block guard (already partially patched)'
);
