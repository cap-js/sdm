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
const FormData = require("form-data");
const { getConfigurations } = require("../../../lib/util/index");
const createAttachment = require("../../../lib/handler/index").createAttachment;
const deleteAttachment = require("../../../lib/handler/index").deleteAttachment;
const readAttachment = require("../../../lib/handler/index").readAttachment;
const readDocument = require("../../../lib/handler/index").readDocument;

describe("handlers", () => {
  describe('ReadAttachment function', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('returns document on successful read', async () => {
      const mockKey = '123';
      const mockToken = 'a1b2c3';
      const mockCredentials = {uri: 'http://example.com/'};
      const mockRepositoryId = '123';
  
      const mockResponse = {data: 'mock pdf file content'};
      const mockBuffer = Buffer.from(mockResponse.data, 'binary');
      
      axios.get.mockResolvedValue(mockResponse);
      getConfigurations.mockReturnValue({repositoryId: mockRepositoryId});
      
      const document = await readAttachment(mockKey, mockToken, mockCredentials);
  
      const expectedUrl = mockCredentials.uri+ "browser/" + mockRepositoryId + "/root?objectID=" + mockKey + "&cmisselector=content";
      expect(axios.get).toHaveBeenCalledWith(expectedUrl, {
        headers: {Authorization: `Bearer ${mockToken}`},
        responseType: 'arraybuffer'
      });
      expect(document).toEqual(mockBuffer);
    });
  
    it('throws error on unsuccessful read', async () => {
      axios.get.mockImplementationOnce(() => Promise.reject({
        response: {
          statusText: 'something bad happened'
        }
      }));
      
      await expect(readAttachment('123', 'a1b2c3', {uri: 'http://example.com/'})).rejects.toThrow('something bad happened');
    });
  });
  
  describe('readDocument function', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });
    
    it('returns a document successfully', async () => {
      const mockKey = '123';
      const mockToken = 'a1b2c3';
      const mockUri = 'http://example.com/';
      const mockRepositoryId = '123';
  
      const mockResponse = {data: 'mock pdf file content'};
      const mockBuffer = Buffer.from(mockResponse.data, 'binary');
      
      axios.get.mockResolvedValue(mockResponse);
      getConfigurations.mockReturnValue({ repositoryId: mockRepositoryId });
     
      const document = await readDocument(mockKey, mockToken, mockUri);
  
      const expectedUrl = mockUri+ "browser/" + mockRepositoryId + "/root?objectID=" + mockKey + "&cmisselector=content";
      expect(axios.get).toHaveBeenCalledWith(expectedUrl, {
        headers: { Authorization: `Bearer ${mockToken}` },
        responseType: 'arraybuffer'
      });
      expect(document).toEqual(mockBuffer);
    });
  
    it('throws error when an error occurrs in axios', async () => {
      axios.get.mockImplementationOnce(() => Promise.reject({
        response: {
          statusText: 'something bad happened'
        }
      }));
      
      await expect(readDocument('123', 'a1b2c3', 'http://example.com/')).rejects.toThrow('something bad happened');
    });
  
    it('throws "An Error Occurred" when an error does not contain response.statusText', async () => {
      axios.get.mockImplementationOnce(() => Promise.reject(new Error()));
      
      await expect(readDocument('123', 'a1b2c3', 'http://example.com/')).rejects.toThrow('An Error Occurred');
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

  describe("deleteAttachment()", () => {
    beforeEach(() => {
      axios.post.mockClear();
    });

    it("should perform the delete operation for given attachment", async () => {
      axios.post.mockResolvedValueOnce({ data: "Deleted" });
      const credentials = { uri: "http://localhost/" };
      const token = "demo-token";
      const objectId = "demo-objectId";
      const attachments = {};

      const response = await deleteAttachment(
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

      const response = await deleteAttachment(
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
});
