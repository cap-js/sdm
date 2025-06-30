const axios = require("axios");
jest.mock("axios");
jest.mock("node-cache", () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  }));
});
let formDataMockedInstances = [];

jest.mock("form-data", () => {
  const FormData = function () {
    const instance = {
      append: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({}),
    };
    formDataMockedInstances.push(instance);
    return instance;
  };
  return FormData;
});
jest.mock("../../../lib/util/index", () => {
  return {
    getConfigurations: jest.fn().mockReturnValue({ repositoryId: "123" }),
    prepareSecondaryProperties: jest.fn(), // Add this mock
    checkMCM: jest.fn(),
    extractSecondaryTypeIds: jest.fn(),
  };
});
const { getConfigurations } = require("../../../lib/util/index");
const {
  createAttachment,
  deleteAttachmentsOfFolder,
  readAttachment,
  getFolderIdByPath,
  getFolderIdByIDAsPath,
  createFolder,
  deleteFolderWithAttachments,
  getAttachment,
  getRepositoryInfo,
  updateAttachment
} = require("../../../lib/handler/index");
const { errorMessage } = require("../../../lib/util/messageConsts");

describe("handlers", () => {
  describe("ReadAttachment function", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns document on successful read", async () => {
      const mockKey = "123";
      const mockToken = "a1b2c3";
      const mockCredentials = { uri: "http://example.com/" };

      const mockResponse = { data: "mock pdf file content" };
      const mockBuffer = Buffer.from(mockResponse.data, "binary");

      axios.get.mockResolvedValue(mockResponse);

      const document = await readAttachment(
        mockKey,
        mockToken,
        mockCredentials
      );

      const expectedUrl =
        mockCredentials.uri +
        "browser/123/root?objectID=" +
        mockKey +
        "&cmisselector=content";
      expect(axios.get).toHaveBeenCalledWith(expectedUrl, {
        headers: { Authorization: `Bearer ${mockToken}` },
        responseType: "arraybuffer",
      });
      expect(document).toEqual(mockBuffer);
    });

    it("throws error on unsuccessful read", async () => {
      axios.get.mockImplementationOnce(() =>
        Promise.reject({
          response: {
            code: 500,
            message: "Could not read the attachment",
          }
        })
      );
    
      await expect(
        readAttachment("123", "a1b2c3", { uri: "http://example.com/" })
      ).rejects.toMatchObject({
        response: {
          code: 500,
            message: "Could not read the attachment",
        },
      });
    });    
  
    it("throws specific error message for 404 status", async () => {
      let actualError = {
        message: "Request failed with status code 404",
        code: "AN ERROR OCCURRED",
        status: 404,
      };
      
      let checkError = {
        message: "Attachment not found in the repository",
        code: 404,
        status: 404,
      };
      
      axios.get.mockImplementationOnce(() =>
        Promise.reject(actualError)
      );
    
      await expect(
        readAttachment("123", "a1b2c3", { uri: "http://example.com/" })
      ).rejects.toMatchObject(checkError);
    });    
  });

  describe("getRepositoryInfo", () => {
    let mockedCredentials, mockedToken, mockRepoInfo, mockReq;
    beforeEach(() => {
      jest.clearAllMocks();
      mockReq = { reject: jest.fn() };
    });

    it("should return repositoryInfo for provided repositoryId", async () => {
      mockedCredentials = { uri: "mocked_uri/" };
      mockedToken = "mocked_token";
      mockRepoInfo = {
        data: {
          "123": {
            capabilities: {
              "capabilityContentStreamUpdatability": "pwconly"
            }
          }
        }
      }
      const mockUrl = mockedCredentials.uri + "browser/" + 123 + "?cmisselector=repositoryInfo";
      axios.get.mockResolvedValue(mockRepoInfo);
      const repoInfo = await getRepositoryInfo(mockReq, mockedCredentials, mockedToken);
      expect(axios.get).toHaveBeenCalledWith(mockUrl, {
        headers: { Authorization: `Bearer ${mockedToken}` }
      });
      expect(repoInfo).toEqual(mockRepoInfo);
    });

    it("throws error on unsuccessful getRepositoryInfo", async () => {
      mockedCredentials = { uri: "mocked_uri/" };
      mockedToken = "mocked_token";
      axios.get.mockImplementationOnce(() =>
        Promise.reject("something bad happened")
      );
      await expect(
        getRepositoryInfo(mockReq, mockedCredentials, mockedToken)
      ).rejects.toThrow("something bad happened");
    });
  })

  describe("Test for getFolderIdByPath", () => {
    let mockedReq, mockedCredentials, mockedToken, mockedAttachments;
    beforeEach(() => {
      jest.clearAllMocks();
      mockedReq = { data: { idValue: "testValue" } };
      mockedCredentials = { uri: "mocked_uri/" };
      mockedToken = "mocked_token";
      mockedAttachments = {
        keys: { up_: { keys: [{ $generatedFieldName: "idValue" }] } },
      };
    });

    it("should return a folderId when axios request is success", async () => {
      const mockedResponse = {
        data: { properties: { "cmis:objectId": { value: "folderId" } } },
      };
      axios.get.mockResolvedValue(mockedResponse);

      const result = await getFolderIdByPath(
        mockedReq,
        mockedCredentials,
        mockedToken,
        mockedAttachments
      );

      // assertions
      expect(result).toEqual("folderId");
      expect(axios.get).toHaveBeenCalledWith(
        "mocked_uri/browser/123/root/testValue?cmisselector=object",
        { headers: { Authorization: "Bearer mocked_token" } }
      );
    });

    it("should return null when axios request fails", async () => {
      axios.get.mockRejectedValue(new Error("Network error"));

      const result = await getFolderIdByPath(
        mockedReq,
        mockedCredentials,
        mockedToken,
        mockedAttachments
      );

      // assertions
      expect(result).toEqual(null);
      expect(axios.get).toHaveBeenCalledWith(
        "mocked_uri/browser/123/root/testValue?cmisselector=object",
        { headers: { Authorization: "Bearer mocked_token" } }
      );
    });

    it("should log statusText and return null when axios.get throws an error with response.statusText", async () => {
      // create the mock objects
      const mockedReq = { data: { field1: "value1" } };
      const mockedCredentials = { uri: "mocked_uri/" };
      const mockedToken = "mocked_token";
      const mockedAttachments = {
        keys: {
          up_: {
            keys: [
              {
                $generatedFieldName: "field1__123",
              },
            ],
          },
        },
      };
      const errorResponse = { statusText: "Some error occurred" };
      axios.get.mockRejectedValue({ response: errorResponse });

      // spy on console.log
      const logSpy = jest.spyOn(console, "log");

      // call the function
      const response = await getFolderIdByPath(
        mockedReq,
        mockedCredentials,
        mockedToken,
        mockedAttachments
      );

      // assert that the function returned null and printed the statusText
      expect(response).toBeNull();
      expect(logSpy).toHaveBeenCalledWith("Some error occurred");

      // restore console.log
      logSpy.mockRestore();
    });
  });

  describe("Test for getFolderIdByIDAsPath", () => {
    let mockedReq, mockedCredentials, mockedToken, mockedAttachments;
  
    beforeEach(() => {
      jest.clearAllMocks();
      mockedReq = { data: { '123': "testValue" } }; // Assuming the ID extracted from field is '123'
      mockedCredentials = { uri: "mocked_uri/" };
      mockedToken = "mocked_token";
      mockedAttachments = {
        keys: { up_: { keys: [{ $generatedFieldName: "field1__123" }] } },
      };
    });
  
    it("should return a folderId when axios request is successful", async () => {
      const mockedResponse = {
        data: { properties: { "cmis:objectId": { value: "folderId" } } },
      };
      axios.get.mockResolvedValue(mockedResponse);
  
      const result = await getFolderIdByIDAsPath(
        mockedReq,
        mockedCredentials,
        mockedToken,
        mockedAttachments
      );
  
      // assertions
      expect(result).toEqual("folderId");
      expect(axios.get).toHaveBeenCalledWith(
        "mocked_uri/browser/123/root/testValue?cmisselector=object",
        { headers: { Authorization: "Bearer mocked_token" } }
      );
    });
  
    it("should return null when axios request fails", async () => {
      axios.get.mockRejectedValue(new Error("Network error"));
  
      const result = await getFolderIdByIDAsPath(
        mockedReq,
        mockedCredentials,
        mockedToken,
        mockedAttachments
      );
  
      // assertions
      expect(result).toEqual(null);
      expect(axios.get).toHaveBeenCalledWith(
        "mocked_uri/browser/123/root/testValue?cmisselector=object",
        { headers: { Authorization: "Bearer mocked_token" } }
      );
    });
  
    it("should log statusText and return null when axios.get throws an error with response.statusText", async () => {
      // Create the mock objects
      const errorResponse = { statusText: "Some error occurred" };
      axios.get.mockRejectedValue({ response: errorResponse });
  
      // Spy on console.log
      const logSpy = jest.spyOn(console, "log");
  
      // Call the function
      const response = await getFolderIdByIDAsPath(
        mockedReq,
        mockedCredentials,
        mockedToken,
        mockedAttachments
      );
  
      // Assert that the function returned null and printed the statusText
      expect(response).toBeNull();
      expect(logSpy).toHaveBeenCalledWith("Some error occurred");
  
      logSpy.mockRestore();
    });
  });

  describe("createFolder", () => {
    it("should create a folder and return expected response when updateServerRequest is successful", async () => {
      // arrange
      const mockResponse = { data: "some_data" };
      axios.post.mockResolvedValue(mockResponse);
      const mockedReq = { data: { field1: "value1" } };
      const mockedCredentials = { uri: "mocked_uri/" };
      const mockedToken = "mocked_token";
      const mockedAttachments = {
        keys: {
          up_: {
            keys: [
              {
                $generatedFieldName: "field1__123",
              },
            ],
          },
        },
      };
      // act
      const response = await createFolder(
        mockedReq,
        mockedCredentials,
        mockedToken,
        mockedAttachments
      );
      // assert
      expect(response).toEqual(mockResponse);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalled();
    });
  });

  describe("createAttachment function", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns response from updateServerRequest", async () => {
      const response = { data: "response" };
      axios.post.mockResolvedValue(response);

      const result = await createAttachment(
        {},
        { uri: "http://test.com" },
        "token",
        {}
      );

      expect(result).toBe(response);
      expect(axios.post).toHaveBeenCalled();
    });

    it("calls getConfigurations", async () => {
      await createAttachment({}, {}, "", {});

      expect(getConfigurations).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteAttachmentsOfFolder()", () => {
    beforeEach(() => {
      axios.post.mockClear();
      jest.clearAllMocks();
    });

    it("should perform the delete operation for given attachment", async () => {
      axios.post.mockResolvedValueOnce({ data: "Deleted" });
      const credentials = { uri: "http://localhost/" };
      const token = "demo-token";
      const objectId = "demo-objectId";
      const attachments = {};

      const response = await deleteAttachmentsOfFolder(
        credentials,
        token,
        objectId,
        attachments
      );
      expect(response.data).toBe("Deleted");
      expect(axios.post).toHaveBeenCalledWith(
        `${credentials.uri}browser/123/root`,
        expect.objectContaining({
          append: expect.any(Function),
          getHeaders: expect.any(Function),
        }),
        { headers: expect.any(Object) }
      );
    });

    it("should throw error when delete operation fails", async () => {
      const error = new Error("Delete operation failed");
      axios.post.mockRejectedValueOnce(error);
      const credentials = { uri: "http://localhost/" };
      const token = "demo-token";
      const objectId = "demo-objectId";
      const attachments = {};
      const response = await deleteAttachmentsOfFolder(
        credentials,
        token,
        objectId,
        attachments
      );

      expect(response).toBeInstanceOf(Error);
      expect(response.message).toBe(error.message);

      expect(axios.post).toHaveBeenCalledWith(
        `${credentials.uri}browser/123/root`,
        expect.objectContaining({
          append: expect.any(Function),
          getHeaders: expect.any(Function),
        }),
        { headers: expect.any(Object) }
      );
    });
  });

  describe("deleteFolderWithAttachments", () => {
    beforeEach(() => {
      axios.post.mockClear();
      jest.clearAllMocks();
    });
    it("should delete a folder and return expected response when updateServerRequest is successful", async () => {
      // arrange
      const mockResponse = { data: "some_data" };
      axios.post.mockResolvedValue(mockResponse);
      const mockedCredentials = { uri: "mocked_uri/" };
      const mockedToken = "mocked_token";
      const parentId = "mocked_parentId";

      // act
      const response = await deleteFolderWithAttachments(
        mockedCredentials,
        mockedToken,
        parentId
      );

      // assert
      expect(response).toEqual(mockResponse);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(axios.post).toHaveBeenCalled();
    });
  });

  describe('getAttachment', () => {
    const uri = 'http://example.com/';
    const token = 'test-token';
    const objectId = 'test-object-id';
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it('should fetch attachment successfully', async () => {
      const mockResponse = { data: 'some data' };
      axios.get.mockResolvedValueOnce(mockResponse);
  
      const response = await getAttachment(uri, token, objectId);
  
      const expectedUrl =`${uri}browser/123/root?cmisselector=object&objectId=${objectId}&succinct=true`;
      expect(axios.get).toHaveBeenCalledWith(expectedUrl, { headers: { Authorization: `Bearer ${token}` } });
      expect(response).toBe(mockResponse);
    });
  
    it('should return null and log status text on error', async () => {
      const errorMessage = 'Not Found';
      const mockError = {
        response: {
          statusText: errorMessage,
        },
      };
      axios.get.mockRejectedValueOnce(mockError);
      console.log = jest.fn(); // Mock console.log
  
      const response = await getAttachment(uri, token, objectId);
  
      expect(console.log).toHaveBeenCalledWith(errorMessage);
      expect(response).toBeNull();
    });
  
    it('should return null and log a default error message when there is no status text', async () => {
      const mockError = {};
      axios.get.mockRejectedValueOnce(mockError);
      console.log = jest.fn(); // Mock console.log
  
      const response = await getAttachment(uri, token, objectId);
  
      expect(console.log).toHaveBeenCalledWith(errorMessage);
      expect(response).toBeNull();
    });
  });

  describe("updateAttachment", () => {
    let req, attachment, credentials, token, updatedSecondaryProperties, secondaryPropertiesWithInvalidDefinitions;
  
    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
  
      req = { reject: jest.fn() };
      attachment = { url: "mockObjectId" };
      credentials = { uri: "http://mock-uri/" };
      token = "mockToken";
      updatedSecondaryProperties = { "cmis:name": "newName", "custom:property": "value" };
      secondaryPropertiesWithInvalidDefinitions = {};
  
      getConfigurations.mockReturnValue({ repositoryId: "mockRepoId" });
    });
  
    it("should update attachment successfully and return status code", async () => {
      const mockResponse = { status: 200 };
    
      // Mock axios.get for getSecondaryTypes and getValidSecondaryProperties
      axios.get.mockImplementation((url) => {
        if (url.includes("typeDescendants")) {
          return Promise.resolve({
            data: [
              {
                type: { id: "cmis:secondary" },
                children: [
                  { type: { id: "type1" } },
                  { type: { id: "type2" } },
                ],
              },
            ],
          });
        } else if (url.includes("typeDefinition")) {
          return Promise.resolve({ data: { propertyDefinitions: {} } });
        }
      });

      require("../../../lib/util/index").extractSecondaryTypeIds.mockImplementation((jsonArray, result) => {
        // Simulate extracting secondary type IDs
        jsonArray.forEach((item) => {
          if (item.type && item.type.id) {
            result.push(item.type.id);
          }
        });
      });
    
      // Mock checkMCM to validate secondary properties
      require("../../../lib/util/index").checkMCM.mockImplementation((responseBody, validSecondaryProperties) => {
        validSecondaryProperties.push("cmis:name", "custom:property");
        return true;
      });
    
      // Mock axios.post for updateServerRequest
      axios.post.mockResolvedValue(mockResponse);
    
      const result = await updateAttachment(
        req,
        attachment,
        credentials,
        token,
        updatedSecondaryProperties,
        secondaryPropertiesWithInvalidDefinitions
      );
    
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledTimes(3); // 1 for getSecondaryTypes, 2 for getValidSecondaryProperties
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenCalledTimes(1);
      expect(result).toBe(200);
    });
  
    it("should throw an error if unsupported properties are found", async () => {
  
      // Mock axios.get for getSecondaryTypes and getValidSecondaryProperties
      axios.get.mockImplementation((url) => {
        if (url.includes("typeDescendants")) {
          return Promise.resolve({
            data: [
              { type: { id: "cmis:secondary" }, children: [{ type: { id: "type1" } }, { type: { id: "type2" } }] },
            ],
          });
        } else if (url.includes("typeDefinition")) {
          return Promise.resolve({ data: { propertyDefinitions: {} } });
        }
      });

      require("../../../lib/util/index").extractSecondaryTypeIds.mockImplementation((jsonArray, result) => {
        // Simulate extracting secondary type IDs
        jsonArray.forEach((item) => {
          if (item.type && item.type.id) {
            result.push(item.type.id);
          }
        });
      });
  
      // Mock checkMCM to validate secondary properties
      require("../../../lib/util/index").checkMCM.mockImplementation((responseBody, validSecondaryProperties) => {
        validSecondaryProperties.push("cmis:name");
        return true;
      });
  
      await expect(
        updateAttachment(
          req,
          attachment,
          credentials,
          token,
          updatedSecondaryProperties,
          secondaryPropertiesWithInvalidDefinitions
        )
      ).rejects.toThrow("Unsupported properties custom:property");
  
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledTimes(3); // 1 for getSecondaryTypes, 2 for getValidSecondaryProperties
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
    });
  
    it("should return 500 if getSecondaryTypes throws an error", async () => {
      // Mock axios.get to throw an error for getSecondaryTypes
      axios.get.mockRejectedValue(new Error("Network error"));
  
      const result = await updateAttachment(
        req,
        attachment,
        credentials,
        token,
        updatedSecondaryProperties,
        secondaryPropertiesWithInvalidDefinitions
      );
  
      expect(result).toBe(500);
      expect(getConfigurations).toHaveBeenCalledTimes(1);
    });

    it("should throw an error if invalid secondary properties are found", async () => {
      const mockResponse = { status: 200 };
    
      // Mock axios.get for getSecondaryTypes and getValidSecondaryProperties
      axios.get.mockImplementation((url) => {
        if (url.includes("typeDescendants")) {
          return Promise.resolve({
            data: [
              {
                type: { id: "cmis:secondary" },
                children: [
                  { type: { id: "type1" } },
                  { type: { id: "type2" } },
                ],
              },
            ],
          });
        } else if (url.includes("typeDefinition")) {
          return Promise.resolve({ data: { propertyDefinitions: {} } });
        }
      });
    
      require("../../../lib/util/index").extractSecondaryTypeIds.mockImplementation((jsonArray, result) => {
        // Simulate extracting secondary type IDs
        jsonArray.forEach((item) => {
          if (item.type && item.type.id) {
            result.push(item.type.id);
          }
        });
      });
    
      // Mock checkMCM to validate secondary properties
      require("../../../lib/util/index").checkMCM.mockImplementation((responseBody, validSecondaryProperties) => {
        validSecondaryProperties.push("cmis:name"); // Only "cmis:name" is valid
        return true;
      });
    
      // Set up secondaryPropertiesWithInvalidDefinitions to match a key in updatedSecondaryProperties
      const secondaryPropertyInvalidDefinition = {
        invalidProperty1: "custom:property", // This matches a key in updatedSecondaryProperties
      };
    
      // Mock axios.post for updateServerRequest
      axios.post.mockResolvedValue(mockResponse);
    
      // Act & Assert
      await expect(
        updateAttachment(
          req,
          attachment,
          credentials,
          token,
          updatedSecondaryProperties,
          secondaryPropertyInvalidDefinition
        )
      ).rejects.toThrow("Unsupported properties custom:property");
    
      // Verify that the mocks were called
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledTimes(3); // 1 for getSecondaryTypes, 2 for getValidSecondaryProperties
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenCalledTimes(0); // Request should not be sent due to the error
    });
  
    it("should throw an error if updateServerRequest fails with a 400 status", async () => {
      const mockErrorResponse = {
        response: {
          status: 400,
          json: jest.fn().mockResolvedValue({ message: "Bad Request" }),
        },
      };
  
      // Mock axios.get for getSecondaryTypes and getValidSecondaryProperties
      axios.get.mockImplementation((url) => {
        if (url.includes("typeDescendants")) {
          return Promise.resolve({
            data: [
              { type: { id: "cmis:secondary" }, children: [{ type: { id: "type1" } }, { type: { id: "type2" } }] },
            ],
          });
        } else if (url.includes("typeDefinition")) {
          return Promise.resolve({ data: { propertyDefinitions: {} } });
        }
      });

      require("../../../lib/util/index").extractSecondaryTypeIds.mockImplementation((jsonArray, result) => {
        // Simulate extracting secondary type IDs
        jsonArray.forEach((item) => {
          if (item.type && item.type.id) {
            result.push(item.type.id);
          }
        });
      });
  
      // Mock checkMCM to validate secondary properties
      require("../../../lib/util/index").checkMCM.mockImplementation((responseBody, validSecondaryProperties) => {
        validSecondaryProperties.push("cmis:name", "custom:property");
        return true;
      });
  
      // Mock axios.post to throw a 400 error
      axios.post.mockRejectedValue(mockErrorResponse);
  
      await expect(
        updateAttachment(
          req,
          attachment,
          credentials,
          token,
          updatedSecondaryProperties,
          secondaryPropertiesWithInvalidDefinitions
        )
      ).rejects.toThrow("Could not update the attachment");
  
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(axios.get).toHaveBeenCalledTimes(3); // 1 for getSecondaryTypes, 2 for getValidSecondaryProperties
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  });
});
