const cds = require('@sap/cds');
const { getConfigurations } = require('./lib/config');
const {
  onCreate,
  beforeAll
} = require('./lib/handlers');
const customServices = [];

/**
 * Initialize the plugin and define its handlers.
 */
cds.once('served', async services => {
  if (cds.env.requires?.['@cap-js/document-management']) await initializePlugin(services);
});

/**
 * Initializes the plugin by configuring services and registering event handlers.
 */
async function initializePlugin(services) {
  getConfigurations();

  cds.env.requires['cmis-client'] = { impl: `${__dirname}/srv/cmis/client` };

  // Extract services with the "@Sdm.Entity" annotation
  const annotatedServices = extractAnnotatedServices(services);

  // Register handlers for each service
  await Promise.all(annotatedServices.map(registerServiceHandlers));
}

/**
 * Extracts services with the "@Sdm.Entity" annotation.
 * @param {Object} services - All services.
 * @returns {Array} An array of services with the "@Sdm.Entity" annotation.
 */
function extractAnnotatedServices(services) {
  return Object.values(services)
    .filter(service => service instanceof cds.ApplicationService)
    .map(service => ({
      name: service.name,
      srv: service,
      entities: Object.values(service.entities).filter(
        entity => entity?.['@Sdm.Entity'],
      ),
    }))
    .filter(service => service.entities.length > 0);
}

const eventHandlersMap = {
  CREATE: onCreate
};

/**
 * Register event handlers for the given service.
 * @param {Object} service - The service to register handlers for.
 */
async function registerServiceHandlers(service) {
  const { srv, entities } = service;

  srv.prepend(() => {
    for (let entity of entities) {
      for (let [event, handler] of Object.entries(eventHandlersMap)) {
        srv.on(event, entity.name, handler);
      }

      srv.before('*', entity.name, beforeAll);
    }
  });
}