const xssec = require("@sap/xssec");
const NodeCache = require("node-cache");

const {
  fetchAccessToken,
  getConfigurations,
  isRepositoryVersioned,
  getClientCredentialsToken,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties,
  extractSecondaryTypeIds,
  checkMCM,
  prepareSecondaryProperties
} = require("../../../lib/util/index");

const cds = require("@sap/cds");
const { sdmAnnotationAdditionalproperty, sdmAnnotationAdditionalpropertyName } = require("../../../lib/util/messageConsts");

jest.mock("../../../lib/persistence", () => ({
  getExistingAttachments: jest.fn(),
}));

let dummyToken = "";
function createDummyToken(payload = {}, header = { alg: 'HS256', typ: 'JWT' }) {
  const base64UrlEncode = obj =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const signature = 'dummy-signature';

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

jest.mock("node-cache");
jest.mock("@sap/cds");
jest.mock("@sap/xssec", () => ({
  v3: {
    requests: {
      requestUserToken: jest.fn(),
      requestClientCredentialsToken: jest.fn()
    },
  },
}));


describe("util", () => {
  describe("fetchAccessToken", () => {
    beforeEach(() => {
      xssec.v3.requests.requestUserToken.mockClear();
      NodeCache.prototype.get.mockClear();
      NodeCache.prototype.set.mockClear();
      dummyToken = createDummyToken({
        sub: "1234567890",
        email: "example@example.com",
        exp: 1516239022
      });

    });

    it("requestUserToken should be called when no token in cache", async () => {
      NodeCache.prototype.get.mockImplementation(() => undefined);
      xssec.v3.requests.requestUserToken.mockImplementation(
        (a, b, c, d, e, f, callback) => callback(null, dummyToken)
      );
      cds.context = {
        user: {
            tokenInfo: {
                getPayload: jest.fn(() => ({
                    ext_attr: {
                        zdn: 'subdomain' // simulate the subdomain extraction
                    }
                })),
            },
        },
      };
      const credentials = { uaa: "uaa" };
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: dummyToken,
          },
        },
      };
      const accessToken =  await fetchAccessToken(credentials, req.user.tokenInfo.getTokenValue);
      const expectedCacheKey = "example@example.com_subdomain";
      expect(xssec.v3.requests.requestUserToken).toBeCalled();
      expect(NodeCache.prototype.set).toBeCalledWith(
        expectedCacheKey,
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
      cds.context = {
        user: {
            tokenInfo: {
                getPayload: jest.fn(() => ({
                    ext_attr: {
                        zdn: 'subdomain' // simulate the subdomain extraction
                    }
                })),
            },
        },
      };
      const credentials = { uaa: "uaa" };
      const accessToken = await fetchAccessToken(credentials, req.user.tokenInfo.getTokenValue);
      expect(NodeCache.prototype.get).toBeCalledWith("example@example.com_subdomain");
      expect(xssec.v3.requests.requestUserToken).toBeCalled();
      expect(accessToken).toBe(dummyToken);
    });

    it("requestUserToken should  be called when there is already token in cache which is not expired", async () => {
      cds.context = {
        user: {
          tokenInfo: {
            getPayload: jest.fn(() => ({
              ext_attr: {
                zdn: 'subdomain' // simulate the subdomain extraction
              }
            })),
          },
        },
      };

      const nowInSeconds = Math.floor(Date.now() / 1000);

      dummyToken = createDummyToken({
        sub: "1234567890",
        email: "example@example.com",
        exp: nowInSeconds + 3600, // 1 hour from now
      });
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
      expect(NodeCache.prototype.get).toBeCalledWith("example@example.com_subdomain");
      expect(xssec.v3.requests.requestUserToken).not.toBeCalled();
      expect(accessToken).toBe(dummyToken);
    });

    it("should throw error when request for access token fails", async () => {
      const consoleErrorSpy = jest
        .spyOn(console, "error")
        .mockImplementation(() => { });
      NodeCache.prototype.get.mockImplementationOnce(() => undefined);
      xssec.v3.requests.requestUserToken.mockImplementation(
        (a, b, c, d, e, f, callback) =>
          callback(new Error("test error"), { statusCode: 500 })
      );
      cds.context = {
        user: {
          tokenInfo: {
            getPayload: jest.fn(() => ({
              ext_attr: {
                zdn: 'subdomain' // simulate the subdomain extraction
              }
            })),
          },
        },
      };
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
        expect(NodeCache.prototype.get).toBeCalledWith("example@example.com_subdomain");
        expect(xssec.v3.requests.requestUserToken).toBeCalled();
        expect(consoleErrorSpy).toBeCalledWith(
          "Response error while fetching access token 500"
        );
        expect(err).toBeInstanceOf(Error);
      } finally {
        consoleErrorSpy.mockRestore();
      }
    });
  });

  describe('getClientCredentialsToken', () => {
    beforeEach(() => {
      xssec.v3.requests.requestClientCredentialsToken.mockClear();
      NodeCache.prototype.get.mockClear();
      NodeCache.prototype.set.mockClear();
    });

    it('returns cached token if available', async () => {
      const cachedToken = 'mockedAccessToken';
      NodeCache.prototype.get.mockImplementation(() => cachedToken);
      cds.context = {
        user: {
            tokenInfo: {
                getPayload: jest.fn(() => ({
                    ext_attr: {
                        zdn: 'subdomain' // simulate the subdomain extraction
                    }
                })),
            },
        },
    };
      const token = await getClientCredentialsToken({ uaa: 'mockedUaa' });

      expect(token).toBe(cachedToken);
      expect(NodeCache.prototype.get).toHaveBeenCalledWith('SDM_ACCESS_TOKEN_subdomain');
      expect(xssec.v3.requests.requestClientCredentialsToken).not.toHaveBeenCalled();
    });

    it('requests new token and caches it if not available', async () => {
      const credentials = { uaa: 'mockedUaa' };
      const mockResponse = { accessToken: 'newAccessToken' };
      NodeCache.prototype.get.mockImplementation(() => undefined);
      xssec.v3.requests.requestClientCredentialsToken.mockImplementation((_, __, ___, callback) => {
        callback(null, mockResponse);
      });
      cds.context = {
        user: {
            tokenInfo: {
                getPayload: jest.fn(() => ({
                    ext_attr: {
                        zdn: 'subdomain' // simulate the subdomain extraction
                    }
                })),
            },
        },
    };
      const token = await getClientCredentialsToken(credentials);

      expect(token).toBe(mockResponse);
      expect(NodeCache.prototype.set).toHaveBeenCalledWith('SDM_ACCESS_TOKEN_subdomain', mockResponse, expect.any(Number));
      expect(xssec.v3.requests.requestClientCredentialsToken).toHaveBeenCalledWith(
        "subdomain",
        credentials.uaa,
        null,
        expect.any(Function)
      );
    });

    it('handles error from requestClientCredentialsToken', async () => {
      const credentials = { uaa: 'mockedUaa' };
      const mockError = new Error('Request failed');
      NodeCache.prototype.get.mockImplementation(() => undefined);
      xssec.v3.requests.requestClientCredentialsToken.mockImplementation((_, __, ___, callback) => {
        callback(mockError, null);
      });

      await expect(getClientCredentialsToken(credentials)).rejects.toThrow();
      expect(NodeCache.prototype.set).not.toHaveBeenCalled();
    });
  });

  describe("isRepositoryVersioned", () => {

    beforeEach(() => {
      NodeCache.prototype.get.mockClear();
      NodeCache.prototype.set.mockClear();
    });

    it("should return true when repotype is pwconly", () => {
      NodeCache.prototype.get.mockImplementation(() => undefined);
      const mockRepoInfo = {
        data: {
          "mockedRepoId": {
            capabilities: {
              "capabilityContentStreamUpdatability": "pwconly"
            }
          }
        }
      }
      const isVersioned = isRepositoryVersioned(mockRepoInfo, "mockedRepoId");
      expect(isVersioned).toBe(true);
      expect(NodeCache.prototype.get).toBeCalledWith("mockedRepoId_subdomain");
      expect(NodeCache.prototype.set).toBeCalledWith("mockedRepoId_subdomain", "versioned", 60 * 60 * 24 * 60);
    });

    it("should not set cache and return true when repotype is pwconly", () => {
      NodeCache.prototype.get.mockImplementation(() => "mockedRepoId");
      const mockRepoInfo = {
        data: {
          "mockedRepoId": {
            capabilities: {
              "capabilityContentStreamUpdatability": "pwconly"
            }
          }
        }
      }
      const isVersioned = isRepositoryVersioned(mockRepoInfo, "mockedRepoId");
      expect(isVersioned).toBe(true);
      expect(NodeCache.prototype.get).toBeCalledWith("mockedRepoId_subdomain");
      expect(NodeCache.prototype.set).not.toHaveBeenCalled();
    });

    it("should return false when repotype is not pwconly", () => {
      NodeCache.prototype.get.mockImplementation(() => undefined);
      const mockRepoInfo = {
        data: {
          "mockedRepoId": {
            capabilities: {
              "capabilityContentStreamUpdatability": "random"
            }
          }
        }
      }

      const isVersioned = isRepositoryVersioned(mockRepoInfo, "mockedRepoId");
      expect(isVersioned).toBe(false);
      expect(NodeCache.prototype.get).toBeCalledWith("mockedRepoId_subdomain");
      expect(NodeCache.prototype.set).toBeCalledWith("mockedRepoId_subdomain", "non-versioned", 60 * 60 * 24 * 60);
    });
  })

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
    it("should return repositoryId from environment variable", () => {
          process.env = {
            REPOSITORY_ID: "repo1",
          };

          const actualSettings = getConfigurations();

          expect(actualSettings).toEqual({  "repositoryId": "repo1"});
        });
  });

  describe("isRestrictedCharactersInName", () => {
    it("should return true if the filename contains a forward slash", () => {
      const filename = "file/name";
      const result = isRestrictedCharactersInName(filename);
      expect(result).toBe(true);
    });

    it("should return true if the filename contains a backslash", () => {
      const filename = "file\\name";
      const result = isRestrictedCharactersInName(filename);
      expect(result).toBe(true);
    });

    it("should return false if the filename does not contain restricted characters", () => {
      const filename = "filename";
      const result = isRestrictedCharactersInName(filename);
      expect(result).toBe(false);
    });

    it("should return false if the filename is empty", () => {
      const filename = "";
      const result = isRestrictedCharactersInName(filename);
      expect(result).toBe(false);
    });

    it("should return false if the filename contains only valid characters", () => {
      const filename = "valid_filename";
      const result = isRestrictedCharactersInName(filename);
      expect(result).toBe(false);
    });
  });

  describe('getStatusCondition', () => {
    it('should return "don\'t" for status code 404', () => {
      const result = getStatusCondition(404);
      expect(result).toBe("don't");
    });

    it('should return "already" for status code 409', () => {
      const result = getStatusCondition(409);
      expect(result).toBe("already");
    });

    it('should return undefined for unknown status code', () => {
      const result = getStatusCondition(500); // Example of a status that isn't handled specifically
      expect(result).toBeUndefined();
    });
  });

  describe("getPropertyTitles", () => {
    it("should return an empty map if attachmentEntity is null", () => {
      const attachmentEntity = null;
      const attachment = { key1: "value1" };

      const result = getPropertyTitles(attachmentEntity, attachment);

      expect(result).toEqual({});
    });

    it("should return a map with property names and titles when annotations are present", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            [sdmAnnotationAdditionalpropertyName]: "property1",
            "@title": "Title 1",
            name: "key1",
          },
          key2: {
            [sdmAnnotationAdditionalpropertyName]: "property2",
            "@title": "Title 2",
            name: "key2",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getPropertyTitles(attachmentEntity, attachment);

      expect(result).toEqual({
        property1: "Title 1",
        property2: "Title 2",
      });
    });

    it("should fallback to element name if @title annotation is not present", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            [sdmAnnotationAdditionalpropertyName]: "property1",
            name: "key1",
          },
          key2: {
            [sdmAnnotationAdditionalpropertyName]: "property2",
            "@title": "Title 2",
            name: "key2",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getPropertyTitles(attachmentEntity, attachment);

      expect(result).toEqual({
        property1: "key1",
        property2: "Title 2",
      });
    });

    it("should skip keys without property names", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            [sdmAnnotationAdditionalpropertyName]: "property1",
            "@title": "Title 1",
            name: "key1",
          },
          key2: {
            "@title": "Title 2",
            name: "key2",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getPropertyTitles(attachmentEntity, attachment);

      expect(result).toEqual({
        property1: "Title 1",
      });
    });

    it("should return an empty map if attachment has no matching keys in attachmentEntity", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            [sdmAnnotationAdditionalpropertyName]: "property1",
            "@title": "Title 1",
            name: "key1",
          },
        },
      };
      const attachment = { key2: "value2" };

      const result = getPropertyTitles(attachmentEntity, attachment);

      expect(result).toEqual({});
    });
  });

  describe("getSecondaryPropertiesWithInvalidDefinition", () => {
    it("should return an empty object if attachmentEntity is null", () => {
      const attachmentEntity = null;
      const attachment = { key1: "value1" };

      const result = getSecondaryPropertiesWithInvalidDefinition(attachmentEntity, attachment);

      expect(result).toEqual({});
    });

    it("should return an empty object if no keys in attachment have outdated annotations", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
            "@title": "Title 1",
          },
          key2: {
            name: "key2",
            "@title": "Title 2",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getSecondaryPropertiesWithInvalidDefinition(attachmentEntity, attachment);

      expect(result).toEqual({});
    });

    it("should return a map of invalid properties with their titles when outdated annotations are present", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
            "@title": "Title 1",
            [sdmAnnotationAdditionalproperty]: true,
          },
          key2: {
            name: "key2",
            "@title": "Title 2",
            [sdmAnnotationAdditionalproperty]: true,
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getSecondaryPropertiesWithInvalidDefinition(attachmentEntity, attachment);

      expect(result).toEqual({
        key1: "Title 1",
        key2: "Title 2",
      });
    });

    it("should fallback to element name if @title annotation is not present", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
            [sdmAnnotationAdditionalproperty]: true,
          },
          key2: {
            name: "key2",
            "@title": "Title 2",
            [sdmAnnotationAdditionalproperty]: true,
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getSecondaryPropertiesWithInvalidDefinition(attachmentEntity, attachment);

      expect(result).toEqual({
        key1: "key1",
        key2: "Title 2",
      });
    });

    it("should skip keys in attachment that do not exist in attachmentEntity.elements", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
            "@title": "Title 1",
            [sdmAnnotationAdditionalproperty]: true,
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" }; // key2 does not exist in attachmentEntity.elements

      const result = getSecondaryPropertiesWithInvalidDefinition(attachmentEntity, attachment);

      expect(result).toEqual({
        key1: "Title 1",
      });
    });
  });

  describe("getSecondaryTypeProperties", () => {
    it("should return an empty map if attachmentEntity is null", () => {
      const attachmentEntity = null;
      const attachment = { key1: "value1" };

      const result = getSecondaryTypeProperties(attachmentEntity, attachment);

      expect(result.size).toBe(0); // Map should be empty
    });

    it("should return an empty map if no keys in attachment have annotations", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
          },
          key2: {
            name: "key2",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getSecondaryTypeProperties(attachmentEntity, attachment);

      expect(result.size).toBe(0); // Map should be empty
    });

    it("should return a map of secondary type properties when annotations are present", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
            [sdmAnnotationAdditionalpropertyName]: "property1",
          },
          key2: {
            name: "key2",
            [sdmAnnotationAdditionalpropertyName]: "property2",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getSecondaryTypeProperties(attachmentEntity, attachment);

      expect(result.size).toBe(2);
      expect(result.get("key1")).toBe("property1");
      expect(result.get("key2")).toBe("property2");
    });

    it("should skip keys in attachment that do not exist in attachmentEntity.elements", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
            [sdmAnnotationAdditionalpropertyName]: "property1",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" }; // key2 does not exist in attachmentEntity.elements

      const result = getSecondaryTypeProperties(attachmentEntity, attachment);

      expect(result.size).toBe(1);
      expect(result.get("key1")).toBe("property1");
      expect(result.has("key2")).toBe(false); // key2 should not be in the map
    });

    it("should handle cases where annotations are missing for some keys", () => {
      const attachmentEntity = {
        elements: {
          key1: {
            name: "key1",
            [sdmAnnotationAdditionalpropertyName]: "property1",
          },
          key2: {
            name: "key2",
          },
        },
      };
      const attachment = { key1: "value1", key2: "value2" };

      const result = getSecondaryTypeProperties(attachmentEntity, attachment);

      expect(result.size).toBe(1);
      expect(result.get("key1")).toBe("property1");
      expect(result.has("key2")).toBe(false); // key2 should not be in the map
    });
  });

  describe("getUpdatedSecondaryProperties", () => {
    it("should return an empty object if there are no differences between attachment and database values", () => {
      const attachment = { property1: "value1", property2: "value2" };
      const secondaryTypeProperties = new Map([
        ["property1", "dbProperty1"],
        ["property2", "dbProperty2"],
      ]);
      const propertiesInDB = { dbProperty1: "value1", dbProperty2: "value2" };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({});
    });

    it("should update properties when attachment value is null and database value is not null", () => {
      const attachment = { property1: null, property2: "value2" };
      const secondaryTypeProperties = new Map([
        ["property1", "dbProperty1"],
        ["property2", "dbProperty2"],
      ]);
      const propertiesInDB = { dbProperty1: "value1", dbProperty2: "value2" };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({ dbProperty1: null });
    });

    it("should update properties when attachment value differs from database value", () => {
      const attachment = { property1: "newValue1", property2: "value2" };
      const secondaryTypeProperties = new Map([
        ["property1", "dbProperty1"],
        ["property2", "dbProperty2"],
      ]);
      const propertiesInDB = { dbProperty1: "value1", dbProperty2: "value2" };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({ dbProperty1: "newValue1" });
    });

    it("should handle cases where database value is null and attachment value is not null", () => {
      const attachment = { property1: "value1", property2: "value2" };
      const secondaryTypeProperties = new Map([
        ["property1", "dbProperty1"],
        ["property2", "dbProperty2"],
      ]);
      const propertiesInDB = { dbProperty1: null, dbProperty2: "value2" };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({ dbProperty1: "value1" });
    });

    it("should handle cases where both attachment and database values are null", () => {
      const attachment = { property1: null, property2: "value2" };
      const secondaryTypeProperties = new Map([
        ["property1", "dbProperty1"],
        ["property2", "dbProperty2"],
      ]);
      const propertiesInDB = { dbProperty1: null, dbProperty2: "value2" };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({});
    });

    it("should handle cases where secondaryTypeProperties is empty", () => {
      const attachment = { property1: "value1", property2: "value2" };
      const secondaryTypeProperties = new Map(); // Empty map
      const propertiesInDB = { dbProperty1: "value1", dbProperty2: "value2" };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({});
    });
  });

  describe("extractSecondaryTypeIds", () => {
    it("should extract type IDs from a flat JSON array", () => {
      const jsonArray = [
        { type: { id: "type1" } },
        { type: { id: "type2" } },
        { type: { id: "type3" } },
      ];
      const result = [];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual(["type1", "type2", "type3"]);
    });

    it("should extract type IDs from a nested JSON array", () => {
      const jsonArray = [
        {
          type: { id: "type1" },
          children: [
            { type: { id: "type2" } },
            { type: { id: "type3" } },
          ],
        },
        { type: { id: "type4" } },
      ];
      const result = [];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual(["type1", "type2", "type3", "type4"]);
    });

    it("should handle JSON objects without a type ID", () => {
      const jsonArray = [
        { type: { id: "type1" } },
        { type: {} }, // No ID
        { children: [{ type: { id: "type2" } }] }, // Nested with valid ID
      ];
      const result = [];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual(["type1", "type2"]);
    });

    it("should handle an empty JSON array", () => {
      const jsonArray = [];
      const result = [];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual([]);
    });

    it("should handle a JSON array with no valid type IDs", () => {
      const jsonArray = [
        { type: {} },
        { children: [{ type: {} }] },
      ];
      const result = [];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual([]);
    });

    it("should not modify the result array if no type IDs are found", () => {
      const jsonArray = [
        { type: {} },
        { children: [{ type: {} }] },
      ];
      const result = ["existingType"];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual(["existingType"]);
    });
  });

  describe("checkMCM", () => {
    it("should return false if responseBody is null or empty", () => {
      const responseBody = "";
      const secondaryPropertyIds = [];

      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(false);
      expect(secondaryPropertyIds).toEqual([]);
    });

    it("should return false if responseBody does not contain propertyDefinitions", () => {
      const responseBody = JSON.stringify({ someOtherKey: {} });
      const secondaryPropertyIds = [];

      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(false);
      expect(secondaryPropertyIds).toEqual([]);
    });

    it("should return false if propertyDefinitions is null or undefined", () => {
      const responseBody = JSON.stringify({ propertyDefinitions: null });
      const secondaryPropertyIds = [];

      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(false);
      expect(secondaryPropertyIds).toEqual([]);
    });

    it("should return true and add keys to secondaryPropertyIds if isPartOfTable is 'true'", () => {
      const responseBody = JSON.stringify({
        propertyDefinitions: {
          key1: { "mcm:miscellaneous": { isPartOfTable: "true" } },
          key2: { "mcm:miscellaneous": { isPartOfTable: "false" } },
          key3: { "mcm:miscellaneous": { isPartOfTable: "true" } },
        },
      });
      const secondaryPropertyIds = [];

      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(true);
      expect(secondaryPropertyIds).toEqual(["key1", "key3"]);
    });

    it("should return false if no properties have isPartOfTable set to 'true'", () => {
      const responseBody = JSON.stringify({
        propertyDefinitions: {
          key1: { "mcm:miscellaneous": { isPartOfTable: "false" } },
          key2: { "mcm:miscellaneous": { isPartOfTable: "false" } },
        },
      });
      const secondaryPropertyIds = [];

      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(false);
      expect(secondaryPropertyIds).toEqual([]);
    });

    it("should handle cases where propertyDefinitions has no mcm:miscellaneous key", () => {
      const responseBody = JSON.stringify({
        propertyDefinitions: {
          key1: {},
          key2: { "mcm:miscellaneous": { isPartOfTable: "false" } },
        },
      });
      const secondaryPropertyIds = [];

      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(false);
      expect(secondaryPropertyIds).toEqual([]);
    });

    it("should handle invalid JSON in responseBody", () => {
      const responseBody = "invalid JSON";
      const secondaryPropertyIds = [];

      expect(() => checkMCM(responseBody, secondaryPropertyIds)).toThrow(SyntaxError);
    });
  });

  describe("prepareSecondaryProperties", () => {
    let formData;

    beforeEach(() => {
      formData = {
        append: jest.fn(), // Mock the append method
      };
    });

    it("should append secondary properties to FormData", () => {
      const secondaryProperties = {
        key1: "value1",
        key2: "value2",
      };

      prepareSecondaryProperties(formData, secondaryProperties);

      expect(formData.append).toHaveBeenCalledTimes(4);
      expect(formData.append).toHaveBeenCalledWith("propertyId[1]", "key1");
      expect(formData.append).toHaveBeenCalledWith("propertyValue[1]", "value1");
      expect(formData.append).toHaveBeenCalledWith("propertyId[2]", "key2");
      expect(formData.append).toHaveBeenCalledWith("propertyValue[2]", "value2");
    });

    it("should handle the 'filename' key and map it to 'cmis:name'", () => {
      const secondaryProperties = {
        filename: "testFileName",
      };

      prepareSecondaryProperties(formData, secondaryProperties);

      expect(formData.append).toHaveBeenCalledTimes(2);
      expect(formData.append).toHaveBeenCalledWith("propertyId[1]", "cmis:name");
      expect(formData.append).toHaveBeenCalledWith("propertyValue[1]", "testFileName");
    });

    it("should handle an empty secondaryProperties object", () => {
      const secondaryProperties = {};

      prepareSecondaryProperties(formData, secondaryProperties);

      expect(formData.append).not.toHaveBeenCalled();
    });

    it("should handle multiple secondary properties including 'filename'", () => {
      const secondaryProperties = {
        filename: "testFileName",
        key1: "value1",
        key2: "value2",
      };

      prepareSecondaryProperties(formData, secondaryProperties);

      expect(formData.append).toHaveBeenCalledTimes(6);
      expect(formData.append).toHaveBeenCalledWith("propertyId[1]", "cmis:name");
      expect(formData.append).toHaveBeenCalledWith("propertyValue[1]", "testFileName");
      expect(formData.append).toHaveBeenCalledWith("propertyId[2]", "key1");
      expect(formData.append).toHaveBeenCalledWith("propertyValue[2]", "value1");
      expect(formData.append).toHaveBeenCalledWith("propertyId[3]", "key2");
      expect(formData.append).toHaveBeenCalledWith("propertyValue[3]", "value2");
    });
  });

});