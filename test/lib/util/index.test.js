const xssec = require("@sap/xssec");
const NodeCache = require("node-cache");
const {
  fetchAccessToken,
  getConfigurations,
} = require("../../../lib/util/index");
const cds = require("@sap/cds");

jest.mock("@sap/xssec");
jest.mock("node-cache");
jest.mock("@sap/cds");

describe("util", () => {
  describe("fetchAccessToken", () => {
    beforeEach(() => {
      xssec.requests.requestClientCredentialsToken.mockClear();
      NodeCache.prototype.get.mockClear();
      NodeCache.prototype.set.mockClear();
    });

    it("requestClientCredentialsToken should be called when no token in cache", async () => {
      NodeCache.prototype.get.mockImplementation(() => undefined);
      xssec.requests.requestClientCredentialsToken.mockImplementation(
        (a, b, c, callback) => callback(null, "new token")
      );

      const credentials = { uaa: "uaa" };
      const accessToken = await fetchAccessToken(credentials);
      expect(NodeCache.prototype.get).toBeCalledWith("SDM_ACCESS_TOKEN");
      expect(xssec.requests.requestClientCredentialsToken).toBeCalled();
      expect(NodeCache.prototype.set).toBeCalledWith(
        "SDM_ACCESS_TOKEN",
        "new token",
        11
      );
      expect(accessToken).toBe("new token");
    });

    it("requestClientCredentialsToken should not be called when there is already token in cache", async () => {
      NodeCache.prototype.get.mockImplementation(() => "token");

      const credentials = { uaa: "uaa" };
      const accessToken = await fetchAccessToken(credentials);
      expect(NodeCache.prototype.get).toBeCalledWith("SDM_ACCESS_TOKEN");
      expect(xssec.requests.requestClientCredentialsToken).not.toBeCalled();
      expect(accessToken).toBe("token");
    });

    it("should throw error when request for access token fails", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => {});
      NodeCache.prototype.get.mockImplementationOnce(() => undefined);
      xssec.requests.requestClientCredentialsToken.mockImplementation(
        (a, b, c, callback) =>
          callback(new Error("test error"), { statusCode: 500 })
      );

      const credentials = { uaa: "uaa" };
      try {
        await fetchAccessToken(credentials);
      } catch (err) {
        expect(NodeCache.prototype.get).toBeCalledWith("SDM_ACCESS_TOKEN");
        expect(xssec.requests.requestClientCredentialsToken).toBeCalled();
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
});
