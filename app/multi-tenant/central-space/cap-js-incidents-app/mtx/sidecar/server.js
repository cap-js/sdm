const cds = require('@sap/cds');
const xsenv = require('@sap/xsenv');

xsenv.loadEnv();

const LOG = cds.log('server');

cds.once('bootstrap', async (app) => {
  LOG.error('Hello');
  app.disable('x-powered-by');

  try {
    const services = xsenv.getServices({
      runtimeRepo: { tag: 'html5-apps-repo-rt' },
      sdm: { tag: 'sdm' },
      destination: { tag: 'destination' },
    });

    const runtimeRepoXsappname = services.runtimeRepo.uaa.xsappname;
    const runtimeSdmXsappname = services.sdm.uaa.xsappname;
    const runtimeDestinationXsappname = services.destination.xsappname;

    if (!cds.env.requires['cds.xt.SaasProvisioningService']) {
      cds.env.requires['cds.xt.SaasProvisioningService'] = {};
    }
    cds.env.requires['cds.xt.SaasProvisioningService'].dependencies = [runtimeRepoXsappname, runtimeSdmXsappname, runtimeDestinationXsappname];
    LOG.info(`Configured SaaS dependency to HTML5 App repo runtime: ${runtimeRepoXsappname}`);
    LOG.info(`Configured SaaS dependency to SDM: ${runtimeSdmXsappname}`);
    LOG.info(`Configured SaaS dependency to Destination: ${runtimeDestinationXsappname}`);
  } catch (err) {
    // LOG.warn(`Could not find service binding for HTML5 app repo runtime. Skipping Saas dependency setup. Error: ${err.message}`);
    LOG.warn(`Could not find service binding for needed dependency. Skipping Saas dependency setup. Error: ${err.message}`);
  }
});

module.exports = cds.server;
