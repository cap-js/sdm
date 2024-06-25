const axios = require("axios");
jest.mock("axios");
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
  };
});
const { getConfigurations } = require("../../../lib/util/index");
const {
  createAttachment,
  deleteAttachmentsOfFolder,
  readAttachment,
  getFolderIdByPath,
  createFolder,
  deleteFolderWithAttachments,
  renameAttachment
} = require("../../../lib/handler/index");

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
            statusText: "something bad happened",
          },
        })
      );

      await expect(
        readAttachment("123", "a1b2c3", { uri: "http://example.com/" })
      ).rejects.toThrow("something bad happened");
    });

    it('throws error with "An Error Occurred" message when statusText is missing', async () => {
      axios.get.mockImplementationOnce(() =>
        Promise.reject({
          response: {},
        })
      );

      await expect(
        readAttachment("123", "a1b2c3", { uri: "http://example.com/" })
      ).rejects.toThrow("An Error Occurred");
    });
  });

  describe("Test for getFolderIdByPath", () => {
    let mockedReq, mockedCredentials, mockedToken, mockedAttachments;
    beforeEach(() => {
      jest.clearAllMocks();
      mockedReq = { data: { idValue: "testValue" } };
      mockedCredentials = { uri: "mocked_uri/" };
      mockedToken = "mocked_token";
      mockedAttachments = {
        keys: { up_: { keys: [{ $generatedFieldName: "__idValue" }] } },
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

  describe("renameAttachment function", () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it("returns response from updateServerRequest without error", async () => {
      const modifiedAttachments = [{name:"name"}];
      const credentials = {};
      const token = "token";
      axios.post.mockResolvedValue({'status' : 201});

      const result = await renameAttachment(
        modifiedAttachments,
        credentials,
        token,
      );
      expect(result.status).toEqual(201);
    });

    it("calls getConfigurations", async () => {
      await renameAttachment({}, {}, "", {});

      expect(getConfigurations).toHaveBeenCalledTimes(1);
    });
  });
});
