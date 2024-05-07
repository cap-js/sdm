const cds = require("@sap/cds/lib");
const { SELECT } = cds.ql;

async function getURLFromAttachments(keys, attachments) {
  return await SELECT.from(attachments, keys).columns("url");
}

module.exports = {
  getURLFromAttachments,
};
