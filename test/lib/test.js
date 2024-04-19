const registerUpdateHandlers = require("../../lib/sdm");
const get = require("../../lib/sdm");
const axios = require("axios").default;
const db = require("db");
 
jest.mock("axios"); // Mock axios for testing
 
describe("sdm Tests", () => {
    // it("should attach deletion data before DELETE or UPDATE operations", async () => {
    //     const mockReq = {
    //       query: {
    //         target: { name: "test_entity" }, // Mock target entity name
    //       },
    //       diff: jest.fn().mockResolvedValue({
    //         attachments: [{ _op: "delete", ID: "attachment_id" }],
    //       }),
    //     };
    //
    //     const handler = new registerUpdateHandlers();
    //     await handler.attachDeletionData(mockReq);
    //
    //     expect(mockReq.attachmentsToDelete).toEqual([{ ID: "attachment_id" }]);
    //   });
  
    it.only("should handle draft save", async () => {
      const mockReq = {
        data: { ID: "test_id" }, // Mock data for req
      };
  
      const mockAttachments = { drafts: "drafts_table" };
      db.query.mockReturnValue([
        {
          filename: "mockedFileName",
          mimeType: "mockedMimeType",
          content: "mockedContent",
          url: "mockedUrl",
          ID: 1,
        },
      ]);
  
      const handler = new registerUpdateHandlers();
      const saveHandler = handler.draftSaveHandler(mockAttachments);
      const mockFetchAccessToken = jest.fn().mockResolvedValue("test_token");
  
      handler.onCreate = jest.fn(); // Mock onCreate method
  
      // Mock fetchAccessToken function
      handler.fetchAccessToken = mockFetchAccessToken;
  
      // Call the save handler
      await saveHandler(null, mockReq);
  
      expect(mockFetchAccessToken).toHaveBeenCalled();
      expect(handler.onCreate).toHaveBeenCalled();
    });
  
    it("should fetch access token", async () => {
      const mockResponse = { access_token: "test_access_token" };
      axios.mockResolvedValue(mockResponse);
  
      const handler = new registerUpdateHandlers();
      const credentials = { ua: "test_uaa" }; // Mock credentials for testing
  
      const token = await handler.fetchAccessToken(credentials);
  
      expect(token).toEqual(mockResponse);
      expect(axios).toHaveBeenCalledWith(/* Axios post request arguments */);
    });
  
    // New test for fetching the correct repository ID
    jest.mock('./get', () => {
      return jest.fn().mockImplementation(() => {
        return {
          getConfigurations: jest.fn().mockResolvedValue({ repositoryId: 'repositoryId' })
        };
      });
    });
  
    it("Should fetch correct repository ID", async () => {
      const mockRepositoryId = "repositoryId";
  
      const handler = new get();
      const repoId = await handler.getConfigurations();
      expect(repoId).toEqual(mockRepositoryId);
    });
  
    // New test for fetching document data
    it("should fetch document data successfully", async () => {
      const mockResponseData = 'mock document data';
      const mockBuffer = Buffer.from(mockResponseData, 'binary');
      axios.get.mockResolvedValueOnce({ data: mockResponseData });
  
      const mockKey = 'mockKey';
      const mockToken = 'mockToken';
      const mockUri = 'mockUri/';
      const mockRepoId = 'repositoryId';
      getConfigurations.mockResolvedValueOnce({ repositoryId: mockRepoId });
  
      const response = await readDocument(mockKey, mockToken, mockUri);
  
      expect(axios.get).toHaveBeenCalledWith(`${mockUri}browser/${mockRepoId}/root?objectID=${mockKey}&cmisselector=content`, {
        headers: { Authorization: `Bearer ${mockToken}` },
        responseType: 'arraybuffer'
      });
      expect(response).toEqual(mockBuffer);
    });
  
    // New test for error handling when fetching document data
    it("should handle error when fetching document data", async () => {
      const mockError = new Error('Failed to fetch document data');
      axios.get.mockRejectedValueOnce(mockError);
  
      const mockKey = 'mockKey';
      const mockToken = 'mockToken';
      const mockUri = 'mockUri/';
      const mockRepoId = 'repositoryId';
      getConfigurations.mockResolvedValueOnce({ repositoryId: mockRepoId });
  
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  
      const response = await readDocument(mockKey, mockToken, mockUri);
  
      expect(axios.get).toHaveBeenCalledWith(`${mockUri}browser/${mockRepoId}/root?objectID=${mockKey}&cmisselector=content`, {
        headers: { Authorization: `Bearer ${mockToken}` },
        responseType: 'arraybuffer'
      });
      expect(response).toBeUndefined();
      expect(consoleErrorSpy).toHaveBeenCalledWith(mockError);
    });
  });
  