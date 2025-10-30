const SDMAttachmentsService = require('../lib/sdm');

module.exports = (srv) => {
  // Get the Attachments entity from your schema
  const { Attachments } = srv.entities;
  
  // Initialize and register SDM service
  const sdmService = new SDMAttachmentsService();
  sdmService.registerUpdateHandlers(srv, Attachments, Attachments);
  
  console.log('SDM Attachments Service registered with non-draft support');
};