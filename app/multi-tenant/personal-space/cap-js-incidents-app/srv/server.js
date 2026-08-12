const cds = require('@sap/cds');
const xsenv = require('@sap/xsenv');

xsenv.loadEnv();

const LOG = cds.log('server');

cds.once('bootstrap', async (app) => {
  LOG.error('Hello');
  app.disable('x-powered-by');

  // try {
  //   const services = xsenv.getServices({
  //     runtimeRepo: { tag: 'html5-apps-repo-rt' },
  //   });

  //   const runtimeRepoXsappname = services.runtimeRepo.uaa.xsappname;

  //   if (!cds.env.requires['cds.xt.SaasProvisioningService']) {
  //     cds.env.requires['cds.xt.SaasProvisioningService'] = {};
  //   }
  //   cds.env.requires['cds.xt.SaasProvisioningService'].dependencies = [runtimeRepoXsappname];
  //   LOG.info(`Configured SaaS dependency to HTML5 App repo runtime: ${runtimeRepoXsappname}`);
  // } catch (err) {
  //   LOG.warn(`Could not find service binding for HTML5 app repo runtime. Skipping Saas dependency setup. Error: ${err.message}`);
  // }
});

cds.once('listening', ({ server }) => {
    // Increase timeout to 60 minutes (3600000ms)
    server.requestTimeout = 3600000; // 60 minutes in milliseconds
});

// --- FLAG TEST: customer validation reject in the `before` phase --------------------
// With uploadInOnPhase=true in sdm settings (or SDM_UPLOAD_IN_ON_PHASE=true), the DMS
// upload runs in the `on` phase, so this before-reject should PREVENT the upload
// entirely (no orphan). With the flag off, SDM's before-upload completes its DMS POST
// first -> orphan. Set REPRO_REJECT false for normal uploads.
const REPRO_REJECT = true;
cds.once('served', () => {
  if (!REPRO_REJECT) { console.log('[REPRO] disabled - normal uploads'); return; }
  const srv = cds.services.ProcessorService;
  if (!srv) { console.log('[REPRO] ProcessorService not found'); return; }
  const rejectUploads = async (req) => {
    if (req.data && req.data.content) {
      // Delay simulates real async validation. With flag OFF (before phase), this lets
      // SDM's concurrent before-upload finish its DMS POST first -> orphan. With flag ON
      // (on phase), the reject in before prevents the on-phase upload entirely.
      await new Promise((resolve) => setTimeout(resolve, 8000));
      console.log('[FLAG-TEST] before-phase validation rejecting upload for', req.data.filename);
      return req.reject(400, 'Simulated validation failure (before phase)');
    }
  };
  srv.before(['UPDATE', 'PUT'], 'Incidents.attachments.drafts', rejectUploads);
  srv.before(['CREATE', 'PUT'], 'Projects.references', rejectUploads);
  console.log('[FLAG-TEST] before-phase reject handlers registered');
});

module.exports = cds.server;
