const cds = require("@sap/cds/lib");
const {
  readAttachment,
} = require("../lib/handler");
const { fetchAccessToken } = require("../lib/util");
const {
  getURLFromAttachments,
} = require("../lib/persistence");

module.exports = class SDMAttachmentsService extends (
  require("@cap-js/attachments/lib/basic")
) {
  init() {
    this.creds = this.options.credentials;
    return super.init();
  }
  getSDMCredentials() {
    return this.creds;
  }

  async get(attachments, keys) {
    const response = await getURLFromAttachments(keys, attachments);
    const token = await fetchAccessToken(this.creds);
    try {
      if (response?.url) {
        const Key = response.url;
        const content = await readAttachment(Key, token, this.creds);
        return content;
      }
      throw new Error("Url not found");
    } catch (error) {
      throw new Error(error);
    }
  }
};
