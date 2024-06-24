const xssec = require("@sap/xssec");
const NodeCache = require("node-cache");
const jwt = require('jsonwebtoken');

const {
  fetchAccessToken,
  getConfigurations,
  checkAttachmentsToRename,
} = require("../../../lib/util/index");

const cds = require("@sap/cds");
const { getExistingAttachments } = require("../../../lib/persistence");

jest.mock("../../../lib/persistence", () => ({
  getExistingAttachments: jest.fn(),
}));

let dummyToken = "";

jest.mock("@sap/xssec");
jest.mock("node-cache");
jest.mock("@sap/cds");

describe("util", () => {
  describe("fetchAccessToken", () => {
    beforeEach(() => {
      xssec.requests.requestUserToken.mockClear();
      NodeCache.prototype.get.mockClear();
      NodeCache.prototype.set.mockClear();
      const payload = {
        "sub": "1234567890",
        "email": "example@example.com",
        "exp": 1516239022
      };

      // Please replace 'your_secret_key' with your own secret key
      const secretKey = 'your_secret_key';

      // sign the token with your secret key
      dummyToken = jwt.sign(payload, secretKey);

    });

    it("requestUserToken should be called when no token in cache", async () => {
      NodeCache.prototype.get.mockImplementation(() => undefined);
      xssec.requests.requestUserToken.mockImplementation(
        (a, b, c, d, e, f, callback) => callback(null, dummyToken)
      );

      const credentials = { uaa: "uaa" };
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: dummyToken,
          },
        },
      };
      const accessToken = await fetchAccessToken(credentials, req.user.tokenInfo.getTokenValue);
      expect(NodeCache.prototype.get).toBeCalledWith("example@example.com");
      expect(xssec.requests.requestUserToken).toBeCalled();
      expect(NodeCache.prototype.set).toBeCalledWith(
        "example@example.com",
        dummyToken,
        11 * 3600
      );
      expect(accessToken).toBe(dummyToken);
    });

    it("requestUserToken should not be called when there is already token in cache which is expired", async () => {
      NodeCache.prototype.get.mockImplementation(() => dummyToken);
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: dummyToken,
          },
        },
      };
      const credentials = { uaa: "uaa" };
      const accessToken = await fetchAccessToken(credentials, req.user.tokenInfo.getTokenValue);
      expect(NodeCache.prototype.get).toBeCalledWith("example@example.com");
      expect(xssec.requests.requestUserToken).toBeCalled();
      expect(accessToken).toBe(dummyToken);
    });

    it("requestUserToken should  be called when there is already token in cache which is not expired", async () => {
      payload = {
        "sub": "1234567890",
        "email": "example@example.com",
        "exp": 2537353178
      };

      // Please replace 'your_secret_key' with your own secret key
      const secretKey = 'your_secret_key';

      // sign the token with your secret key
      dummyToken = jwt.sign(payload, secretKey);
      NodeCache.prototype.get.mockImplementation(() => dummyToken);
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: dummyToken,
          },
        },
      };
      const credentials = { uaa: "uaa" };
      const accessToken = await fetchAccessToken(credentials, req.user.tokenInfo.getTokenValue);
      expect(NodeCache.prototype.get).toBeCalledWith("example@example.com");
      expect(xssec.requests.requestUserToken).not.toBeCalled();
      expect(accessToken).toBe(dummyToken);
    });

    it("should throw error when request for access token fails", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => { });
      NodeCache.prototype.get.mockImplementationOnce(() => undefined);
      xssec.requests.requestUserToken.mockImplementation(
        (a, b, c, d, e, f, callback) =>
          callback(new Error("test error"), { statusCode: 500 })
      );
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: dummyToken,
          },
        },
      };
      const credentials = { uaa: "uaa" };
      try {
        await fetchAccessToken(credentials, req.user.tokenInfo.getTokenValue);
      } catch (err) {
        expect(NodeCache.prototype.get).toBeCalledWith("example@example.com");
        expect(xssec.requests.requestUserToken).toBeCalled();
        expect(consoleErrorSpy).toBeCalledWith(
          "Response error while fetching access token 500"
        );
        expect(err).toBeInstanceOf(Error);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe("getConfigurations", () => {
    it("should return attachments settings if exists", () => {
      cds.env = {
        requires: {
          sdm: {
            settings: {
              param1: "value1",
              param2: "value2",
            },
          },
        },
      };
      const expectedSettings = {
        param1: "value1",
        param2: "value2",
      };

      const actualSettings = getConfigurations();

      expect(actualSettings).toEqual(expectedSettings);
    });

    it("should return an empty object if attachments settings does not exist", () => {
      cds.env = {
        requires: {},
      };

      const actualSettings = getConfigurations();

      expect(actualSettings).toEqual({});
    });
  });

  describe("checkAttachmentsToRename", () => {
    it("should do nothing if attachment_val_rename is empty", async () => {
      attachment_val_rename = [];
      attachmentIDs = [];
      attachments = [];
      await checkAttachmentsToRename(attachment_val_rename, attachmentIDs, attachments)
      expect(getExistingAttachments).not.toBeCalled();
    });

    it("should call getExistingAttachments if attachment_val_rename is not empty", async () => {
      attachment_val_rename = [
        {
          ID: 1,
          filename: "name1",
          url: "url1",
        },
        {
          ID: 2,
          filename: "name2",
          url: "url2",
        },
      ];
      attachmentIDs = ["1", "2"];
      attachments = ["attachments1", "attachments2"];
      const existingAttachments = [
        {
          ID: 1,
          filename: "Old_File.pdf",
          folderId: "folder1",
        },
        {
          ID: 2,
          filename: "Another_Old_File.pdf",
          folderId: "folder2",
        },
      ];      

      getExistingAttachments.mockResolvedValueOnce(existingAttachments);

      await checkAttachmentsToRename(attachment_val_rename, attachmentIDs, attachments)

      expect(getExistingAttachments).toBeCalled();
    });
  });
});
