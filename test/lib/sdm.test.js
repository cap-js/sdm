const SDMAttachmentsService = require("../../lib/sdm");
const { fetchAccessToken } = require("../../lib/util");
const { readAttachment, readDocument } = require("../../lib/handler/index")
const cds = require("@sap/cds");

jest.mock("../../lib/util");
jest.mock("../../lib/handler");
jest.mock("@sap/cds", () => {
  return {
    debug: jest.fn(),
    ql: {
      SELECT: {
        from: jest.fn().mockReturnThis(),
        columns: jest.fn().mockResolvedValueOnce({ url: "mockUrl" }),
      },
    },
  };
});
jest.mock("@cap-js/attachments/lib/basic", () => class {});
jest.mock("../../lib/util");

describe("Test get method", () => {
  let service;
  beforeEach(() => {
    service = new SDMAttachmentsService();
    service.creds = { uri: "mock_cred" };
  });

  it("should interact with DB, fetch access token and readAttachment with correct parameters", async () => {
    const attachments = ["attachment1", "attachment2"];
    const keys = ["key1", "key2"];
    const token = "dummy_token";

    fetchAccessToken.mockResolvedValueOnce(token);

    await service.get(attachments, keys);
    
    expect(cds.ql.SELECT.from).toHaveBeenCalledWith(attachments, keys);
    expect(cds.ql.SELECT.columns).toHaveBeenCalledWith("url");
    expect(fetchAccessToken).toHaveBeenCalledWith(service.creds);
    expect(readAttachment).toHaveBeenCalledWith("mockUrl", token, service.creds);
  });

  it("should throw an error if the url is not found", async () => {
    const attachments = ["attachment1", "attachment2"];
    const keys = ["key1", "key2"];
    const token = "dummy_token";
  
    cds.ql.SELECT.columns.mockResolvedValueOnce({});
  
    fetchAccessToken.mockResolvedValueOnce(token);
  
    try {
      await service.get(attachments, keys);
    } catch(e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).toHaveProperty('message', 'Error: Url not found');
    }
  
    expect(cds.ql.SELECT.from).toHaveBeenCalledWith(attachments, keys);
    expect(cds.ql.SELECT.columns).toHaveBeenCalledWith('url');
    expect(fetchAccessToken).toHaveBeenCalledWith(service.creds);
  });
});
