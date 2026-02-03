const NodeCache = require("node-cache");

const {
  getConfigurations,
  isRepositoryVersioned,
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
jest.mock("@sap-cloud-sdk/connectivity", () => ({
  jwtBearerToken: jest.fn(),
  serviceToken: jest.fn(),
  decodeJwt: jest.fn()
}));


describe("util", () => {
  describe("isRepositoryVersioned", () => {
    
    beforeEach(() => {
      NodeCache.prototype.get.mockClear();
      NodeCache.prototype.set.mockClear();
      // Mock cds.context for isRepositoryVersioned tests
      cds.context = {
        user: {
          authInfo: {
            token: {
              payload: {
                ext_attr: {
                  zdn: "subdomain"
                }
              }
            }
          }
        }
      };
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

  describe("OAuth2 Token Transformation Functions", () => {
    let mockJwtBearerToken;
    let mockServiceToken;
    let mockDecodeJwt;

    beforeEach(() => {
      jest.clearAllMocks();
      // Mock @sap-cloud-sdk/connectivity functions
      mockJwtBearerToken = require("@sap-cloud-sdk/connectivity").jwtBearerToken;
      mockServiceToken = require("@sap-cloud-sdk/connectivity").serviceToken;
      mockDecodeJwt = require("@sap-cloud-sdk/connectivity").decodeJwt;
    });

    describe("buildOAuth2JWTBearerDestination", () => {
      it("should build OAuth2 JWT Bearer destination with expiration", () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        
        const { buildOAuth2JWTBearerDestination } = require("../../../lib/util/index");
        const token = "test-jwt-token";
        const url = "https://example.com";
        const name = "test-destination";

        const result = buildOAuth2JWTBearerDestination(token, url, name);

        expect(result).toEqual({
          url,
          name,
          authentication: 'OAuth2JWTBearer',
          authTokens: [
            {
              value: token,
              type: 'bearer',
              expiresIn: expect.any(String),
              http_header: {
                key: 'Authorization',
                value: `Bearer ${token}`
              },
              error: null
            }
          ]
        });
        expect(mockDecodeJwt).toHaveBeenCalledWith(token);
      });

      it("should build OAuth2 JWT Bearer destination without expiration", () => {
        mockDecodeJwt.mockReturnValue({});
        
        const { buildOAuth2JWTBearerDestination } = require("../../../lib/util/index");
        const token = "test-jwt-token";
        const url = "https://example.com";
        const name = "test-destination";

        const result = buildOAuth2JWTBearerDestination(token, url, name);

        expect(result.authTokens[0].expiresIn).toBeUndefined();
      });
    });

    describe("transformSDMServiceBindingToJWTBearerCredentialsDestination", () => {
      beforeEach(() => {
        cds.context = undefined;
      });

      it("should transform service binding with user JWT", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockJwtBearerToken.mockResolvedValue("generated-token");
        cds.context = { user: { authInfo: { token: { payload: { ext_attr: {} } } } } };

        const { transformSDMServiceBindingToJWTBearerCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://uaa.example.com",
              clientid: "client123",
              clientsecret: "secret123"
            }
          }
        };
        const userJwt = "user-jwt-token";

        const result = await transformSDMServiceBindingToJWTBearerCredentialsDestination(service, {}, userJwt);

        expect(mockJwtBearerToken).toHaveBeenCalledWith(
          userJwt,
          expect.objectContaining({
            name: "sdm-service"
          }),
          {}
        );
        expect(result.authentication).toBe('OAuth2JWTBearer');
        expect(result.name).toBe("sdm-service");
      });

      it("should replace provider subdomain with tenant subdomain", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockJwtBearerToken.mockResolvedValue("generated-token");
        cds.context = { user: { authInfo: { token: { payload: { ext_attr: { zdn: "tenant-subdomain" } } } } } };

        const { transformSDMServiceBindingToJWTBearerCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://provider-subdomain.example.com/oauth/token",
              clientid: "client123",
              clientsecret: "secret123"
            }
          }
        };
        const userJwt = "user-jwt-token";

        const result = await transformSDMServiceBindingToJWTBearerCredentialsDestination(service, {}, userJwt);

        expect(mockJwtBearerToken).toHaveBeenCalledWith(userJwt, expect.objectContaining({
          credentials: expect.objectContaining({ url: "https://tenant-subdomain.example.com/oauth/token" })
        }), {});
        expect(result.url).toBe("https://tenant-subdomain.example.com/oauth/token");
        expect(result.authentication).toBe('OAuth2JWTBearer');
      });

      it("should not replace subdomain when tenant not available", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockJwtBearerToken.mockResolvedValue("generated-token");
        cds.context = { user: { authInfo: { token: { payload: { ext_attr: {} } } } } };

        const { transformSDMServiceBindingToJWTBearerCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://provider-subdomain.example.com/oauth/token",
              clientid: "client123"
            }
          }
        };

        const result = await transformSDMServiceBindingToJWTBearerCredentialsDestination(service, {}, "jwt");

        expect(mockJwtBearerToken).toHaveBeenCalledWith("jwt", expect.objectContaining({
          credentials: expect.objectContaining({ url: "https://provider-subdomain.example.com/oauth/token" })
        }), {});
        expect(result.url).toBe("https://provider-subdomain.example.com/oauth/token");
      });

      it("should handle missing cds context gracefully", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockJwtBearerToken.mockResolvedValue("generated-token");
        cds.context = undefined;

        const { transformSDMServiceBindingToJWTBearerCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://provider-subdomain.example.com/oauth/token",
              clientid: "client123"
            }
          }
        };

        const result = await transformSDMServiceBindingToJWTBearerCredentialsDestination(service, {}, "jwt");

        expect(mockJwtBearerToken).toHaveBeenCalledWith("jwt", expect.objectContaining({
          credentials: expect.objectContaining({ url: "https://provider-subdomain.example.com/oauth/token" })
        }), {});
        expect(result.authentication).toBe('OAuth2JWTBearer');
      });
    });

    describe("transformSDMServiceBindingToClientCredentialsDestination", () => {
      beforeEach(() => {
        cds.context = undefined;
      });

      it("should transform service binding with client credentials", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockServiceToken.mockResolvedValue("generated-client-token");
        cds.context = { user: { authInfo: { token: { payload: { ext_attr: {} } } } } };
        
        const { transformSDMServiceBindingToClientCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://uaa.example.com",
              clientid: "client123",
              clientsecret: "secret123"
            }
          }
        };
        const options = { some: "option" };

        const result = await transformSDMServiceBindingToClientCredentialsDestination(service, options);

        expect(mockServiceToken).toHaveBeenCalledWith(expect.objectContaining({ name: "sdm-service" }), options);
        expect(result.authentication).toBe('OAuth2ClientCredentials');
        expect(result.name).toBe("sdm-service");
      });

      it("should replace provider subdomain with tenant subdomain", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockServiceToken.mockResolvedValue("generated-client-token");
        cds.context = { user: { authInfo: { token: { payload: { ext_attr: { zdn: "tenant-subdomain" } } } } } };

        const { transformSDMServiceBindingToClientCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://provider-subdomain.example.com/oauth/token",
              clientid: "client123",
              clientsecret: "secret123"
            }
          }
        };

        const result = await transformSDMServiceBindingToClientCredentialsDestination(service, {});

        expect(mockServiceToken).toHaveBeenCalledWith(expect.objectContaining({
          credentials: expect.objectContaining({ url: "https://tenant-subdomain.example.com/oauth/token" })
        }), {});
        expect(result.url).toBe("https://tenant-subdomain.example.com/oauth/token");
        expect(result.authentication).toBe('OAuth2ClientCredentials');
      });

      it("should not replace subdomain when tenant not available", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockServiceToken.mockResolvedValue("generated-client-token");
        cds.context = { user: { authInfo: { token: { payload: { ext_attr: {} } } } } };

        const { transformSDMServiceBindingToClientCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://provider-subdomain.example.com/oauth/token",
              clientid: "client123"
            }
          }
        };

        const result = await transformSDMServiceBindingToClientCredentialsDestination(service, {});

        expect(mockServiceToken).toHaveBeenCalledWith(expect.objectContaining({
          credentials: expect.objectContaining({ url: "https://provider-subdomain.example.com/oauth/token" })
        }), {});
        expect(result.url).toBe("https://provider-subdomain.example.com/oauth/token");
      });

      it("should handle missing cds context gracefully", async () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        mockServiceToken.mockResolvedValue("generated-client-token");
        cds.context = undefined;

        const { transformSDMServiceBindingToClientCredentialsDestination } = require("../../../lib/util/index");
        const service = {
          name: "sdm-service",
          credentials: {
            uaa: {
              url: "https://provider-subdomain.example.com/oauth/token",
              clientid: "client123"
            }
          }
        };

        const result = await transformSDMServiceBindingToClientCredentialsDestination(service, {});

        expect(mockServiceToken).toHaveBeenCalledWith(expect.objectContaining({
          credentials: expect.objectContaining({ url: "https://provider-subdomain.example.com/oauth/token" })
        }), {});
        expect(result.authentication).toBe('OAuth2ClientCredentials');
      });
    });

    describe("buildClientCredentialsDestination", () => {
      it("should build OAuth2 Client Credentials destination with expiration", () => {
        const futureExp = Math.floor(Date.now() / 1000) + 3600;
        mockDecodeJwt.mockReturnValue({ exp: futureExp });
        
        const { buildClientCredentialsDestination } = require("../../../lib/util/index");
        const token = "test-client-token";
        const url = "https://example.com";
        const name = "test-destination";

        const result = buildClientCredentialsDestination(token, url, name);

        expect(result).toEqual({
          url,
          name,
          authentication: 'OAuth2ClientCredentials',
          authTokens: [
            {
              value: token,
              type: 'bearer',
              expiresIn: expect.any(String),
              http_header: {
                key: 'Authorization',
                value: `Bearer ${token}`
              },
              error: null
            }
          ]
        });
        expect(mockDecodeJwt).toHaveBeenCalledWith(token);
      });

      it("should build OAuth2 Client Credentials destination without expiration", () => {
        mockDecodeJwt.mockReturnValue({});
        
        const { buildClientCredentialsDestination } = require("../../../lib/util/index");
        const token = "test-client-token";
        const url = "https://example.com";
        const name = "test-destination";

        const result = buildClientCredentialsDestination(token, url, name);

        expect(result.authTokens[0].expiresIn).toBeUndefined();
      });
    });

    describe("getSdmInstanceName", () => {
      const originalEnv = process.env.VCAP_SERVICES;

      afterEach(() => {
        if (originalEnv !== undefined) {
          process.env.VCAP_SERVICES = originalEnv;
        } else {
          delete process.env.VCAP_SERVICES;
        }
      });

      it("should extract SDM instance name from VCAP_SERVICES", () => {
        process.env.VCAP_SERVICES = JSON.stringify({
          sdm: [
            {
              name: "my-sdm-instance",
              credentials: {}
            }
          ]
        });

        const { getSdmInstanceName } = require("../../../lib/util/index");
        const result = getSdmInstanceName();

        expect(result).toBe("my-sdm-instance");
      });

      it("should return null when sdm service not in VCAP_SERVICES", () => {
        process.env.VCAP_SERVICES = JSON.stringify({
          someOtherService: []
        });

        const { getSdmInstanceName } = require("../../../lib/util/index");
        const result = getSdmInstanceName();

        expect(result).toBeNull();
      });

      it("should return null when sdm array is empty", () => {
        process.env.VCAP_SERVICES = JSON.stringify({
          sdm: []
        });

        const { getSdmInstanceName } = require("../../../lib/util/index");
        const result = getSdmInstanceName();

        expect(result).toBeNull();
      });
    });
  });

  describe("getPropertyTitles edge cases", () => {
    it("should skip elements without propertyName", () => {
      const attachmentEntity = {
        elements: {
          field1: {
            '@title': 'Field 1 Title',
            name: 'field1'
            // No @SDM.Attachments.AdditionalProperty.name
          },
          field2: {
            '@SDM.Attachments.AdditionalProperty.name': 'customField',
            '@title': 'Field 2 Title',
            name: 'field2'
          }
        }
      };
      const attachment = { field1: 'value1', field2: 'value2' };

      const result = getPropertyTitles(attachmentEntity, attachment);

      expect(result).toHaveProperty('customField', 'Field 2 Title');
      expect(result).not.toHaveProperty('field1');
    });

    it("should use element name as fallback when no @title", () => {
      const attachmentEntity = {
        elements: {
          field1: {
            '@SDM.Attachments.AdditionalProperty.name': 'customField',
            name: 'field1'
            // No @title
          }
        }
      };
      const attachment = { field1: 'value1' };

      const result = getPropertyTitles(attachmentEntity, attachment);

      expect(result).toHaveProperty('customField', 'field1');
    });
  });

  describe("getSecondaryPropertiesWithInvalidDefinition edge cases", () => {
    it("should handle elements without SDM annotation", () => {
      const attachmentEntity = {
        elements: {
          normalField: {
            name: 'normalField'
            // No sdm.additionalproperty annotation
          }
        }
      };
      const attachment = { normalField: 'value' };

      const result = getSecondaryPropertiesWithInvalidDefinition(attachmentEntity, attachment);

      expect(result).toEqual({});
    });
  });

  describe("getUpdatedSecondaryProperties null value handling", () => {
    it("should handle null currentValue and non-null dbValue", () => {
      const attachment = { 'field1': null };
      const secondaryTypeProperties = new Map([['field1', 'custom:field']]);
      const propertiesInDB = { 'custom:field': 'oldValue' };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toHaveProperty('custom:field', null);
    });

    it("should handle non-null currentValue different from dbValue", () => {
      const attachment = { 'field1': 'newValue' };
      const secondaryTypeProperties = new Map([['field1', 'custom:field']]);
      const propertiesInDB = { 'custom:field': 'oldValue' };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toHaveProperty('custom:field', 'newValue');
    });

    it("should skip when both values are null", () => {
      const attachment = { 'field1': null };
      const secondaryTypeProperties = new Map([['field1', 'custom:field']]);
      const propertiesInDB = { 'custom:field': null };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({});
    });

    it("should skip when values are equal", () => {
      const attachment = { 'field1': 'sameValue' };
      const secondaryTypeProperties = new Map([['field1', 'custom:field']]);
      const propertiesInDB = { 'custom:field': 'sameValue' };

      const result = getUpdatedSecondaryProperties(attachment, secondaryTypeProperties, propertiesInDB);

      expect(result).toEqual({});
    });
  });

  describe("extractSecondaryTypeIds recursion", () => {
    it("should handle nested children recursively", () => {
      const jsonArray = [
        {
          type: { id: 'parent' },
          children: [
            {
              type: { id: 'child1' },
              children: [
                { type: { id: 'grandchild' } }
              ]
            },
            { type: { id: 'child2' } }
          ]
        }
      ];
      const result = [];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual(['parent', 'child1', 'grandchild', 'child2']);
    });

    it("should handle items without type.id", () => {
      const jsonArray = [
        { type: { id: 'valid' } },
        { type: {} }, // No id
        { children: [{ type: { id: 'nested' } }] } // No type.id but has children
      ];
      const result = [];

      extractSecondaryTypeIds(jsonArray, result);

      expect(result).toEqual(['valid', 'nested']);
    });
  });

  describe("checkMCM edge cases", () => {
    it("should return false for empty responseBody", () => {
      const result = checkMCM("", []);
      expect(result).toBe(false);
    });

    it("should return false for whitespace-only responseBody", () => {
      const result = checkMCM("   ", []);
      expect(result).toBe(false);
    });

    it("should return false when propertyDefinitions is null", () => {
      const responseBody = JSON.stringify({ propertyDefinitions: null });
      const result = checkMCM(responseBody, []);
      expect(result).toBe(false);
    });

    it("should skip properties without miscellaneous", () => {
      const responseBody = JSON.stringify({
        propertyDefinitions: {
          'field1': { type: 'string' }, // No miscellaneous
          'field2': {
            'mcm:miscellaneous': { isPartOfTable: 'true' }
          }
        }
      });
      const secondaryPropertyIds = [];
      
      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(true);
      expect(secondaryPropertyIds).toEqual(['field2']);
    });

    it("should skip properties where isPartOfTable is not true", () => {
      const responseBody = JSON.stringify({
        propertyDefinitions: {
          'field1': {
            'mcm:miscellaneous': { isPartOfTable: 'false' }
          }
        }
      });
      const secondaryPropertyIds = [];
      
      const result = checkMCM(responseBody, secondaryPropertyIds);

      expect(result).toBe(false);
      expect(secondaryPropertyIds).toEqual([]);
    });
  });

  describe("getConfigurations with environment variable", () => {
    const originalEnv = process.env.REPOSITORY_ID;

    afterEach(() => {
      if (originalEnv !== undefined) {
        process.env.REPOSITORY_ID = originalEnv;
      } else {
        delete process.env.REPOSITORY_ID;
      }
    });

    it("should return repositoryId from environment variable when set", () => {
      process.env.REPOSITORY_ID = "env-repo-id";

      const result = getConfigurations();

      expect(result).toEqual({ repositoryId: "env-repo-id" });
    });

    it("should return cds.env settings when environment variable not set", () => {
      delete process.env.REPOSITORY_ID;
      cds.env = {
        requires: {
          sdm: {
            settings: { repositoryId: "cds-repo-id" }
          }
        }
      };

      const result = getConfigurations();

      expect(result).toEqual({ repositoryId: "cds-repo-id" });
    });
  });

  describe("isRepositoryVersioned else branch", () => {
    it("should return false for non-pwconly repoType", () => {
      // Set up proper cds.context
      cds.context = { user: { authInfo: { token: { payload: { ext_attr: { zdn: 'test-subdomain' } } } } } };
      
      const repoInfo = {
        data: {
          repo123: {
            capabilities: {
              capabilityContentStreamUpdatability: "anytime"
            }
          }
        }
      };

      const result = isRepositoryVersioned(repoInfo, "repo123");

      expect(result).toBe(false);
    });
  });
});
