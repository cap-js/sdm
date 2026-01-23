const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
jest.mock("@sap-cloud-sdk/http-client");
jest.mock("node-cache", () => {
  return jest.fn().mockImplementation(() => ({
    get: jest.fn(),
    set: jest.fn(),
  }));
});
let mockFormDataInstances = [];

jest.mock("form-data", () => {
  const FormData = function () {
    const instance = {
      append: jest.fn(),
      getHeaders: jest.fn().mockReturnValue({}),
    };
  mockFormDataInstances.push(instance);
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
  updateAttachment,
  editLink
} = require("../../../lib/handler/index");
const { errorMessage } = require("../../../lib/util/messageConsts");

describe("handlers", () => {
  describe("ReadAttachment function", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns document on successful read", async () => {
      const mockKey = "123";
      const mockDestination = { url: "http://example.com" };
      const mockCredentials = { uri: "http://example.com/" };

      const mockResponse = { data: "mock pdf file content" };

      executeHttpRequest.mockResolvedValue(mockResponse);

      const document = await readAttachment(
        mockKey,
        mockDestination,
        mockCredentials
      );

      expect(executeHttpRequest).toHaveBeenCalledWith(
        mockDestination,
        {
          method: 'GET',
          url: mockCredentials.uri + "browser/123/root?objectID=" + mockKey + "&cmisselector=content",
          responseType: "stream",
        }
      );
      expect(document.data).toEqual(mockResponse.data);
    });

    it("throws error on unsuccessful read", async () => {
      executeHttpRequest.mockImplementationOnce(() =>
        Promise.reject({
          response: {
            code: 500,
            message: "Could not read the attachment",
          }
        })
      );
    
      const result = await readAttachment("123", "a1b2c3", { uri: "http://example.com/" });
      expect(result).toBe("An error occurred");
    });

    it("should return statusText when error has response.statusText", async () => {
      jest.clearAllMocks();
      executeHttpRequest.mockImplementation(
        jest.fn(() =>
          Promise.reject({
            message: "Request failed",
            response: {
              statusText: "Not Found"
            }
          })
        )
      );
    
      const result = await readAttachment("123", "a1b2c3", { uri: "http://example.com/" });
      expect(result).toBe("Not Found");
    });

    it("throws specific error message for 404 status", async () => {
      let actualError = {
        message: "Request failed with status code 404",
        code: "AN ERROR OCCURRED",
        status: 404,
      };
      
      executeHttpRequest.mockImplementationOnce(() =>
        Promise.reject(actualError)
      );
    
      const result = await readAttachment("123", "a1b2c3", { uri: "http://example.com/" });
      expect(result).toBe("An error occurred");
    });    
  });

  describe("getRepositoryInfo", () => {
    let mockedCredentials, mockedDestination, mockRepoInfo, mockReq;
    beforeEach(() => {
      jest.clearAllMocks();
      mockReq = { reject: jest.fn() };
    });

    it("should return repositoryInfo for provided repositoryId", async () => {
      mockedCredentials = { uri: "mocked_uri/" };
      mockedDestination = { url: "http://example.com" };
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
      executeHttpRequest.mockResolvedValue(mockRepoInfo);
      const repoInfo = await getRepositoryInfo(mockReq, mockedCredentials, mockedDestination);
      expect(executeHttpRequest).toHaveBeenCalledWith(mockedDestination, {
        method: 'GET',
        url: mockUrl
      });
      expect(repoInfo).toEqual(mockRepoInfo);
    });

    it("throws error on unsuccessful getRepositoryInfo", async () => {
      mockedCredentials = { uri: "mocked_uri/" };
      mockedDestination = { url: "http://example.com" };
      executeHttpRequest.mockImplementationOnce(() =>
        Promise.reject("something bad happened")
      );
      await expect(
        getRepositoryInfo(mockReq, mockedCredentials, mockedDestination)
      ).rejects.toThrow("something bad happened");
    });
    it("should reject with 404 when repository info not found", async () => {
        mockedCredentials = { uri: "mocked_uri/" };
        mockedDestination = { url: "http://example.com" };
        executeHttpRequest.mockRejectedValue({
          response: { status: 404 }
        });

        await expect(getRepositoryInfo(mockReq, mockedCredentials, mockedDestination)).rejects.toThrow();
        expect(mockReq.reject).toHaveBeenCalledWith(404, "Failed to get repository info");
      });

      it("should reject with 500 and a message from the server", async () => {
        const errorMessage = 'Internal Server Error';
        mockedCredentials = { uri: "mocked_uri/" };
        mockedDestination = { url: "http://example.com" };
        executeHttpRequest.mockRejectedValue({
          response: { status: 500, data: { message: errorMessage } }
        });

        await expect(getRepositoryInfo(mockReq, mockedCredentials, mockedDestination)).rejects.toThrow();
        expect(mockReq.reject).toHaveBeenCalledWith(500, errorMessage);
      });
  })

  describe("Test for getFolderIdByPath", () => {
    let mockedReq, mockedCredentials, mockedDestination, mockedAttachments;
    beforeEach(() => {
      jest.clearAllMocks();
      mockedReq = { data: { idValue: "testValue" } };
      mockedCredentials = { uri: "mocked_uri/" };
      mockedDestination = { url: "http://example.com" };
      mockedAttachments = {
        keys: { up_: { keys: [{ $generatedFieldName: "idValue" }] } },
      };
    });

    it("should return a folderId when axios request is success", async () => {
      const mockedResponse = {
        data: { properties: { "cmis:objectId": { value: "folderId" } } },
      };
      executeHttpRequest.mockResolvedValue(mockedResponse);

      const result = await getFolderIdByPath(
        mockedReq,
        mockedCredentials,
        mockedAttachments,
        undefined,
        mockedDestination
      );

      // assertions
      expect(result).toEqual("folderId");
      expect(executeHttpRequest).toHaveBeenCalledWith(
        mockedDestination,
        {
          method: 'GET',
          url: "mocked_uri/browser/123/root/testValue?cmisselector=object"
        }
      );
    });

    it("should return null when axios request fails", async () => {
      executeHttpRequest.mockRejectedValue(new Error("Network error"));

      const result = await getFolderIdByPath(
        mockedReq,
        mockedCredentials,
        mockedAttachments,
        undefined,
        mockedDestination
      );

      // assertions
      expect(result).toEqual(null);
      expect(executeHttpRequest).toHaveBeenCalledWith(
        mockedDestination,
        {
          method: 'GET',
          url: "mocked_uri/browser/123/root/testValue?cmisselector=object"
        }
      );
    });

    it("should log statusText and return null when executeHttpRequest throws an error with response.statusText", async () => {
      // create the mock objects
      const mockedReq = { data: { field1: "value1" } };
      const mockedCredentials = { uri: "mocked_uri/" };
      const mockedDestination = { url: "http://example.com" };
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
      executeHttpRequest.mockRejectedValue({ response: errorResponse });

      // spy on console.log
      const logSpy = jest.spyOn(console, "log");

      // call the function
      const response = await getFolderIdByPath(
        mockedReq,
        mockedCredentials,
        mockedAttachments,
        undefined,
        mockedDestination
      );

      // assert that the function returned null and printed the statusText
      expect(response).toBeNull();
      expect(logSpy).toHaveBeenCalledWith("Some error occurred");

      // restore console.log
      logSpy.mockRestore();
    });
  });

  describe("Test for getFolderIdByIDAsPath", () => {
    let mockedReq, mockedCredentials, mockedDestination, mockedAttachments;
  
    beforeEach(() => {
      jest.clearAllMocks();
      mockedReq = { data: { '123': "testValue" } }; // Assuming the ID extracted from field is '123'
      mockedCredentials = { uri: "mocked_uri/" };
      mockedDestination = { url: "http://example.com" };
      mockedAttachments = {
        keys: { up_: { keys: [{ $generatedFieldName: "field1__123" }] } },
      };
    });
  
    it("should return a folderId when axios request is successful", async () => {
      const mockedResponse = {
        data: { properties: { "cmis:objectId": { value: "folderId" } } },
      };
      executeHttpRequest.mockResolvedValue(mockedResponse);
  
      const result = await getFolderIdByIDAsPath(
        mockedReq,
        mockedCredentials,
        mockedDestination,
        mockedAttachments
      );
  
      // assertions
      expect(result).toEqual("folderId");
      expect(executeHttpRequest).toHaveBeenCalledWith(
        mockedDestination,
        {
          method: 'GET',
          url: "mocked_uri/browser/123/root/testValue?cmisselector=object"
        }
      );
    });
  
    it("should return null when axios request fails", async () => {
      executeHttpRequest.mockRejectedValue(new Error("Network error"));
  
      const result = await getFolderIdByIDAsPath(
        mockedReq,
        mockedCredentials,
        mockedDestination,
        mockedAttachments
      );
  
      // assertions
      expect(result).toEqual(null);
      expect(executeHttpRequest).toHaveBeenCalledWith(
        mockedDestination,
        {
          method: 'GET',
          url: "mocked_uri/browser/123/root/testValue?cmisselector=object"
        }
      );
    });
  
    it("should log statusText and return null when executeHttpRequest throws an error with response.statusText", async () => {
      // Create the mock objects
      const errorResponse = { statusText: "Some error occurred" };
      executeHttpRequest.mockRejectedValue({ response: errorResponse });
  
      // Spy on console.log
      const logSpy = jest.spyOn(console, "log");
  
      // Call the function
      const response = await getFolderIdByIDAsPath(
        mockedReq,
        mockedCredentials,
        mockedDestination,
        mockedAttachments
      );
  
      // Assert that the function returned null and printed the statusText
      expect(response).toBeNull();
      expect(logSpy).toHaveBeenCalledWith("Some error occurred");
  
      logSpy.mockRestore();
    });
  });

  describe("createFolder", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      executeHttpRequest.mockClear();
    });

    it("should create a folder and return expected response when updateServerRequest is successful", async () => {
      // arrange
      const mockResponse = { data: "some_data" };
      executeHttpRequest.mockResolvedValue(mockResponse);
      const mockedReq = { data: { field1: "value1" } };
      const mockedCredentials = { uri: "mocked_uri/" };
      const mockedDestination = { url: "http://example.com" };
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
        mockedAttachments,
        undefined,
        mockedDestination
      );
      // assert
      expect(response).toEqual(mockResponse);
      expect(executeHttpRequest).toHaveBeenCalledTimes(1);
      expect(executeHttpRequest).toHaveBeenCalled();
    });
  });

  describe("createAttachment function", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns response from updateServerRequest", async () => {
      const response = { data: "response" };
      executeHttpRequest.mockResolvedValue(response);

      const result = await createAttachment(
        {},
        { uri: "http://test.com" },
        {},
        { url: "http://test.com" }
      );

      expect(result).toBe(response);
      expect(executeHttpRequest).toHaveBeenCalled();
    });

    it("calls getConfigurations", async () => {
      await createAttachment({}, {}, {}, { url: "http://test.com" });

      expect(getConfigurations).toHaveBeenCalledTimes(1);
    });

    it("should append correct fields for internet shortcut mimeType", async () => {
      const response = { data: "response" };
      executeHttpRequest.mockResolvedValue(response);

      const data = {
        filename: "link.url",
        mimeType: "application/internet-shortcut",
        linkUrl: "http://example.com"
      };
      const credentials = { uri: "http://test.com/" };
      const destination = { url: "http://test.com" };
      const parentId = "parentId";

      await createAttachment(data, credentials, parentId, destination);

      // Get the last created FormData mock instance
      const formDataInstance = mockFormDataInstances[mockFormDataInstances.length - 1];

      expect(formDataInstance.append).toHaveBeenCalledWith("cmisaction", "createDocument");
      expect(formDataInstance.append).toHaveBeenCalledWith("objectId", parentId);
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyId[0]", "cmis:name");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyValue[0]", data.filename);
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyId[1]", "cmis:objectTypeId");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyValue[1]", "cmis:document");
      expect(formDataInstance.append).toHaveBeenCalledWith("succinct", "true");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyId[2]", "cmis:secondaryObjectTypeIds");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyValue[2]", "sap:createLink");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyId[3]", "sap:linkRepositoryId");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyValue[3]", "123");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyId[4]", "sap:linkExternalURL");
      expect(formDataInstance.append).toHaveBeenCalledWith("propertyValue[4]", data.linkUrl);
    });
  });

  describe("editLink", () => {
    let objectId, filename, linkUrl, credentials, destination;

    beforeEach(() => {
      jest.clearAllMocks();
      mockFormDataInstances = [];
      objectId = 'test-object-id';
      filename = 'MyLink';
      linkUrl = 'https://www.successfactors.com';
      credentials = { uri: 'http://test-uri.com/' };
      destination = { url: 'http://test-uri.com' };
    });

    it('should successfully edit a link and return the response', async () => {
      const mockResponse = { status: 200, data: 'OK' };
      executeHttpRequest.mockResolvedValue(mockResponse);

      const response = await editLink(objectId, filename, linkUrl, credentials, destination);

      const expectedFilename = `${filename}.url`;
      const urlShortcut = `[InternetShortcut]\nURL=${linkUrl}`;
      const fileContent = Buffer.from(urlShortcut, 'utf-8');

      // Check if executeHttpRequest was called correctly
      expect(executeHttpRequest).toHaveBeenCalledTimes(1);
      const postCallArgs = executeHttpRequest.mock.calls[0];
      expect(postCallArgs[0]).toBe(destination);
      expect(postCallArgs[1].url).toContain('browser/123/root');

      // Check FormData content
      const formDataInstance = mockFormDataInstances[0];
      expect(formDataInstance.append).toHaveBeenCalledWith("cmisaction", "setContent");
      expect(formDataInstance.append).toHaveBeenCalledWith("objectId", objectId);
      expect(formDataInstance.append).toHaveBeenCalledWith("filename", expectedFilename);
      expect(formDataInstance.append).toHaveBeenCalledWith("charset", "UTF-8");
      expect(formDataInstance.append).toHaveBeenCalledWith("succinct", "true");
      expect(formDataInstance.append).toHaveBeenCalledWith("media", fileContent, {
          filename: expectedFilename,
          contentType: "application/internet-shortcut",
      });

      expect(response).toEqual(mockResponse);
    });

    it('should use "link.url" as filename if filename is not provided', async () => {
      executeHttpRequest.mockResolvedValue({ status: 200 });

      await editLink(objectId, null, linkUrl, credentials, destination);

      const formDataInstance = mockFormDataInstances[0];
      const expectedFilename = 'link.url';

      expect(formDataInstance.append).toHaveBeenCalledWith("filename", expectedFilename);
      expect(formDataInstance.append).toHaveBeenCalledWith("media", expect.any(Buffer), {
          filename: expectedFilename,
          contentType: "application/internet-shortcut",
      });
    });

    it('should return an error if the server request fails', async () => {
      const mockError = new Error('Request failed');
      executeHttpRequest.mockRejectedValue(mockError);

      await expect(editLink(objectId, filename, linkUrl, credentials, destination)).rejects.toThrow('Request failed');

      expect(executeHttpRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe("deleteAttachmentsOfFolder()", () => {
    beforeEach(() => {
      executeHttpRequest.mockClear();
      jest.clearAllMocks();
    });

    it("should perform the delete operation for given attachment", async () => {
      executeHttpRequest.mockResolvedValueOnce({ data: "Deleted" });
      const credentials = { uri: "http://localhost/" };
      const destination = { url: "http://localhost" };
      const objectId = "demo-objectId";

      const response = await deleteAttachmentsOfFolder(
        credentials,
        destination,
        objectId
      );
      expect(response.data).toBe("Deleted");
      expect(executeHttpRequest).toHaveBeenCalledWith(
        destination,
        expect.objectContaining({
          method: "POST",
          url: expect.stringContaining('browser/123/root'),
          data: expect.objectContaining({
            append: expect.any(Function),
            getHeaders: expect.any(Function),
          })
        })
      );
    });

    it("should return error object when delete operation fails", async () => {
      const error = new Error("Delete operation failed");
      executeHttpRequest.mockRejectedValueOnce(error);
      const credentials = { uri: "http://localhost/" };
      const destination = { url: "http://localhost" };
      const objectId = "demo-objectId";
      
      const result = await deleteAttachmentsOfFolder(credentials, destination, objectId);
      expect(result).toEqual({
        status: undefined,
        response: undefined,
        message: 'Delete operation failed'
      });
    });
  });

  describe("deleteFolderWithAttachments", () => {
    beforeEach(() => {
      executeHttpRequest.mockClear();
      jest.clearAllMocks();
    });
    it("should delete a folder and return expected response when updateServerRequest is successful", async () => {
      // arrange
      const mockResponse = { data: "some_data" };
      executeHttpRequest.mockResolvedValue(mockResponse);
      const mockedCredentials = { uri: "mocked_uri/" };
      const mockedDestination = { url: "http://example.com" };
      const parentId = "mocked_parentId";

      // act
      const response = await deleteFolderWithAttachments(
        mockedCredentials,
        mockedDestination,
        parentId
      );

      // assert
      expect(response).toEqual(mockResponse);
      expect(executeHttpRequest).toHaveBeenCalledTimes(1);
      expect(executeHttpRequest).toHaveBeenCalled();
    });
  });

  describe('getAttachment', () => {
    const uri = 'http://example.com/';
    const destination = { url: 'http://example.com' };
    const objectId = 'test-object-id';
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it('should fetch attachment successfully', async () => {
      const mockResponse = { data: 'some data' };
      executeHttpRequest.mockResolvedValueOnce(mockResponse);
  
      const response = await getAttachment(uri, destination, objectId);
  
      const expectedUrl =`${uri}browser/123/root?cmisselector=object&objectId=${objectId}&succinct=true`;
      expect(executeHttpRequest).toHaveBeenCalledWith(destination, {
        method: 'GET',
        url: expectedUrl
      });
      expect(response).toBe(mockResponse);
    });
  
    it('should return null and log status text on error', async () => {
      const errorMessage = 'Not Found';
      const mockError = {
        response: {
          statusText: errorMessage,
        },
      };
      executeHttpRequest.mockRejectedValueOnce(mockError);
      console.log = jest.fn(); // Mock console.log
  
      const response = await getAttachment(uri, destination, objectId);
  
      expect(console.log).toHaveBeenCalledWith(errorMessage);
      expect(response).toBe("Not Found");
    });
  
    it('should return null and log a default error message when there is no status text', async () => {
      const mockError = {};
      executeHttpRequest.mockRejectedValueOnce(mockError);
      console.log = jest.fn(); // Mock console.log
  
      const response = await getAttachment(uri, destination, objectId);
  
      expect(console.log).toHaveBeenCalledWith(errorMessage);
      expect(response).toBe("An error occurred");
    });
  });

  describe("updateAttachment", () => {
    let req, attachment, credentials, destination, updatedSecondaryProperties, secondaryPropertiesWithInvalidDefinitions;
  
    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
  
      req = { reject: jest.fn() };
      attachment = { url: "mockObjectId" };
      credentials = { uri: "http://mock-uri/" };
      destination = { url: "http://mock-uri" };
      updatedSecondaryProperties = { "cmis:name": "newName", "custom:property": "value" };
      secondaryPropertiesWithInvalidDefinitions = {};
  
      getConfigurations.mockReturnValue({ repositoryId: "mockRepoId" });
    });
  
    it("should update attachment successfully and return status code", async () => {
      const mockResponse = { status: 200 };
    
      // Mock executeHttpRequest for getSecondaryTypes and getValidSecondaryProperties
      executeHttpRequest.mockImplementation((destination, options) => {
        if (options.url.includes("typeDescendants")) {
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
        } else if (options.url.includes("typeDefinition")) {
          return Promise.resolve({ data: { propertyDefinitions: {} } });
        } else {
          return Promise.resolve(mockResponse);
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
    
      const result = await updateAttachment(
        req,
        attachment,
        credentials,
        destination,
        updatedSecondaryProperties,
        secondaryPropertiesWithInvalidDefinitions
      );
    
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(executeHttpRequest).toHaveBeenCalledTimes(4); // 1 for getSecondaryTypes, 2 for getValidSecondaryProperties, 1 for update
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
      expect(result).toBe(200);
    });
  
    it("should throw an error if unsupported properties are found", async () => {
  
      // Mock executeHttpRequest for getSecondaryTypes and getValidSecondaryProperties
      executeHttpRequest.mockImplementation((destination, options) => {
        if (options.url.includes("typeDescendants")) {
          return Promise.resolve({
            data: [
              { type: { id: "cmis:secondary" }, children: [{ type: { id: "type1" } }, { type: { id: "type2" } }] },
            ],
          });
        } else if (options.url.includes("typeDefinition")) {
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
        destination,
        updatedSecondaryProperties,
          secondaryPropertiesWithInvalidDefinitions
        )
      ).rejects.toThrow("Unsupported properties custom:property");
  
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(executeHttpRequest).toHaveBeenCalledTimes(3); // 1 for getSecondaryTypes, 2 for getValidSecondaryProperties
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
    });
  
    it("should return 500 if getSecondaryTypes throws an error", async () => {
      // Mock executeHttpRequest to throw an error for getSecondaryTypes
      executeHttpRequest.mockRejectedValue(new Error("Network error"));
  
      const result = await updateAttachment(
        req,
        attachment,
        credentials,
        destination,
        updatedSecondaryProperties,
        secondaryPropertiesWithInvalidDefinitions
      );
  
      expect(result).toBe(500);
      expect(getConfigurations).toHaveBeenCalledTimes(1);
    });

    it("should throw an error if invalid secondary properties are found", async () => {
    
      // Mock executeHttpRequest for getSecondaryTypes and getValidSecondaryProperties
      executeHttpRequest.mockImplementation((destination, options) => {
        if (options.url.includes("typeDescendants")) {
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
        } else if (options.url.includes("typeDefinition")) {
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
    
      // Act & Assert
      await expect(
        updateAttachment(
        req,
        attachment,
        credentials,
        destination,
        updatedSecondaryProperties,
          secondaryPropertyInvalidDefinition
        )
      ).rejects.toThrow("Unsupported properties custom:property");
    
      // Verify that the mocks were called
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(executeHttpRequest).toHaveBeenCalledTimes(3); // 1 for getSecondaryTypes, 2 for getValidSecondaryProperties
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
    });
  
    it("should throw an error if updateServerRequest fails with a 400 status", async () => {
      const mockErrorResponse = {
        response: {
          status: 400,
          json: jest.fn().mockResolvedValue({ message: "Bad Request" }),
        },
      };
  
      // Mock executeHttpRequest for getSecondaryTypes and getValidSecondaryProperties
      let callCount = 0;
      executeHttpRequest.mockImplementation((destination, options) => {
        callCount++;
        if (options.url.includes("typeDescendants")) {
          return Promise.resolve({
            data: [
              { type: { id: "cmis:secondary" }, children: [{ type: { id: "type1" } }, { type: { id: "type2" } }] },
            ],
          });
        } else if (options.url.includes("typeDefinition")) {
          return Promise.resolve({ data: { propertyDefinitions: {} } });
        } else if (callCount >= 4) {
          // On the final call (update request), throw error
          return Promise.reject(mockErrorResponse);
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
  
      await expect(
        updateAttachment(
        req,
        attachment,
        credentials,
        destination,
        updatedSecondaryProperties,
          secondaryPropertiesWithInvalidDefinitions
        )
      ).rejects.toThrow("Could not update the attachment");
  
      expect(getConfigurations).toHaveBeenCalledTimes(1);
      expect(require("../../../lib/util/index").checkMCM).toHaveBeenCalledTimes(2);
    });

    it("should handle error during update request", async () => {
      // Mock executeHttpRequest for getSecondaryTypes and getValidSecondaryProperties
      let callCount = 0;
      executeHttpRequest.mockImplementation((destination, options) => {
        callCount++;
        if (options.url.includes("typeDescendants")) {
          return Promise.resolve({
            data: [
              { type: { id: "cmis:secondary" }, children: [{ type: { id: "type1" } }] },
            ],
          });
        } else if (options.url.includes("typeDefinition")) {
          return Promise.resolve({ data: { propertyDefinitions: {} } });
        } else if (callCount >= 4) {
          throw new Error("Network error");
        }
      });

      require("../../../lib/util/index").extractSecondaryTypeIds.mockImplementation((jsonArray, result) => {
        jsonArray.forEach((item) => {
          if (item.type && item.type.id) {
            result.push(item.type.id);
          }
        });
      });
    
      require("../../../lib/util/index").checkMCM.mockImplementation((responseBody, validSecondaryProperties) => {
        validSecondaryProperties.push("cmis:name", "custom:property");
        return true;
      });
    
      await expect(
        updateAttachment(
          req,
          attachment,
          credentials,
          destination,
          updatedSecondaryProperties,
          secondaryPropertiesWithInvalidDefinitions
        )
      ).rejects.toThrow("Could not update the attachment");
    });
  });
});
