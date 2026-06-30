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

module.exports = cds.server;
