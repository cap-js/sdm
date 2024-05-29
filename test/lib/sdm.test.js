const SDMAttachmentsService = require("../../lib/sdm");
const fetchAccessToken = require("../../lib/util").fetchAccessToken;
const {
  getDraftAttachments,
  getURLsToDeleteFromAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
} = require("../../lib/persistence");
const {
  deleteAttachmentsOfFolder,
  createAttachment,
  readAttachment,
  getFolderIdByPath,
  createFolder,
  deleteFolderWithAttachments,
} = require("../../lib/handler");
const {
  duplicateDraftFileErr,
  emptyFileErr,
} = require("../../lib/util/messageConsts");

jest.mock("@cap-js/attachments/lib/basic", () => class {});
jest.mock("../../lib/persistence", () => ({
  getDraftAttachments: jest.fn(),
  getDuplicateAttachments: jest.fn(),
  getURLsToDeleteFromAttachments: jest.fn(),
  getURLFromAttachments: jest.fn(),
  getFolderIdForEntity: jest.fn(),
}));
jest.mock("../../lib/util", () => ({
  fetchAccessToken: jest.fn(),
}));
jest.mock("../../lib/handler", () => ({
  deleteAttachmentsOfFolder: jest.fn(),
  createAttachment: jest.fn(),
  readAttachment: jest.fn(),
  getFolderIdByPath: jest.fn(),
  createFolder: jest.fn(),
  deleteFolderWithAttachments: jest.fn(),
}));
jest.mock("@sap/cds/lib", () => {
  const mockCds = {
    model: {
      definitions: {},
    },
  };
  return mockCds;
});

describe("SDMAttachmentsService", () => {
  describe("Test get method", () => {
    let service;
    beforeEach(() => {
      const cds = require("@sap/cds");
      service = new SDMAttachmentsService();
      service.creds = { uri: "mock_cred" };
    });

    it("should interact with DB, fetch access token and readAttachment with correct parameters", async () => {
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
      };
    
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const token = "mocked_token";
      const response = { url: "mockUrl" };
    
      // set req in service instance
    
      getURLFromAttachments.mockResolvedValueOnce(response);
      fetchAccessToken.mockResolvedValueOnce(token);
      readAttachment.mockResolvedValueOnce('dummy_content');
    
      await service.get(attachments, keys,req); // call get method
    
      expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'tokenValue');
      expect(readAttachment).toHaveBeenCalledWith(
        "mockUrl",
        token,
        service.creds
      );
    });

   it("should throw error if readAttachment fails", async () => {
   const req = {
     user: {
       tokenInfo: {
         getTokenValue: jest.fn().mockReturnValue('tokenValue'),
       },
     },
   };
     const attachments = ["attachment1", "attachment2"];
     const keys = ["key1", "key2"];
     const token = "mocked_token";
     const response = { url: "mockUrl" };
     fetchAccessToken.mockResolvedValueOnce(token);
     getURLFromAttachments.mockResolvedValueOnce(response);
     readAttachment.mockImplementationOnce(() => {
       throw new Error("Error reading attachment");
     });



     await expect(service.get(attachments, keys,req)).rejects.toThrow(
       "Error reading attachment"
     );

     expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
     expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'tokenValue');
     expect(readAttachment).toHaveBeenCalledWith(
       "mockUrl",
       token,
       service.creds
     );
   });
  });
  describe("draftSaveHandler", () => {
    let service;
    let mockReq;
    let cds;
    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
      service.creds = { uaa: "mocked uaa" };
      mockReq = {
        query: {
          target: {
            name: "testName",
          },
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('mocked_token'),
          },
        },
        reject: jest.fn(),
        info: jest.fn(),
      };

      cds.model.definitions[mockReq.query.target.name + ".attachments"] = {
        keys: {
          up_: {
            keys: [{ ref: ["attachment"] }],
          },
        },
      };
    });

    it("draftSaveHandler() should do nothing when getDraftAttachments() returns empty array", async () => {
      getDraftAttachments.mockResolvedValueOnce([]);
      await service.draftSaveHandler(mockReq);
      expect(getDraftAttachments).toHaveBeenCalledTimes(1);
      expect(fetchAccessToken).toHaveBeenCalledTimes(0);
      expect(getFolderIdForEntity).toHaveBeenCalledTimes(0);
    });

    it("draftSaveHandler() should call getFolderIdByPath if getFolderIdForEntity returns empty array", async () => {
      getDraftAttachments.mockResolvedValueOnce(["file1", "file2"]);
      service.isFileNameDuplicateInDrafts = jest.fn().mockReturnValueOnce("");
      fetchAccessToken.mockResolvedValueOnce("mocked_token");
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce("mocked_folder_id");
      service.onCreate = jest.fn().mockResolvedValueOnce([]);
      await service.draftSaveHandler(mockReq);
      expect(getDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledTimes(1);
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'mocked_token');
      expect(getFolderIdForEntity).toHaveBeenCalledTimes(1);
      expect(getFolderIdByPath).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        "mocked_token",
        cds.model.definitions[mockReq.query.target.name + ".attachments"]
      );
    });

    it("draftSaveHandler() should call createFolder if getFolderIdForEntity and getFolderIdByPath return empty", async () => {
      const attachments = ["file1", "file2"];
      getDraftAttachments.mockResolvedValueOnce(attachments);
      service.isFileNameDuplicateInDrafts = jest.fn().mockReturnValueOnce("");
      fetchAccessToken.mockResolvedValueOnce("mocked_token");
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce(null);
      createFolder.mockResolvedValueOnce({
        data: {
          succinctProperties: {
            "cmis:objectId": "new_folder_id",
          },
        },
      });
      service.onCreate = jest.fn().mockResolvedValueOnce([]);
      await service.draftSaveHandler(mockReq);
      expect(createFolder).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        "mocked_token",
        cds.model.definitions[mockReq.query.target.name + ".attachments"]
      );
      expect(service.onCreate).toHaveBeenCalledWith(
        attachments,
        service.creds,
        "mocked_token",
        cds.model.definitions[mockReq.query.target.name + ".attachments"],
        mockReq,
        "new_folder_id"
      );
    });

    it("should handle failure in onCreate", async () => {
      service.isFileNameDuplicate = jest.fn().mockResolvedValue("");
      service.onCreate = jest.fn().mockResolvedValue(["ChildTest"]);

      getDraftAttachments.mockResolvedValue([{}]);

      await service.draftSaveHandler(mockReq);

      expect(mockReq.info).toHaveBeenCalledWith(200, "\nTest");
    });

    it("should not call onCreate if no draft attachments are available", async () => {
      getDraftAttachments.mockResolvedValue([]);
      const onCreateSpy = jest.spyOn(service, "onCreate");
      await service.draftSaveHandler(mockReq);

      expect(onCreateSpy).not.toBeCalled();
    });

    it("should handle successful onCreate without any issue", async () => {
      service.isFileNameDuplicate = jest.fn().mockResolvedValue("");
      service.onCreate = jest.fn().mockResolvedValue([]);
      getDraftAttachments.mockResolvedValue([{}]);

      await service.draftSaveHandler(mockReq);

      expect(mockReq.info).not.toBeCalled();
    });

    it("should reject if duplicate draft files exist", async () => {
      const duplicateErrMsg = "Duplicate Error Message";
      const mockAttachments = [
        { name: "Attachment#1" },
        { name: "Attachment#2" },
      ];
      // Mock method return values
      getDraftAttachments.mockResolvedValue(mockAttachments);
      service.isFileNameDuplicateInDrafts = jest
        .fn()
        .mockReturnValue(duplicateErrMsg);
      service.onCreate = jest
        .fn()
        .mockResolvedValue(["Failed request 1", "Failed request 2"]);

      // Method under test
      await service.draftSaveHandler(mockReq);

      // Assert mockReq.reject was called with the right arguments
      expect(mockReq.reject).toHaveBeenCalledWith(
        409,
        duplicateDraftFileErr(duplicateErrMsg)
      );

      // verify if getDraftAttachments was called
      expect(getDraftAttachments).toHaveBeenCalledWith(
        expect.anything(),
        mockReq
      );
    });
  });

  describe("attachDeletionData", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
    });
    it("should add attachments to delete in req when deletions are present", async () => {
  
      const mockedReq = {
        query: {
          target: {
            name: "myName",
          },
          user: {
            tokenInfo: {
              getTokenValue: jest.fn().mockReturnValue('tokenValue'),
            },
          },
        },
        diff: jest.fn().mockResolvedValue({
          attachments: [
            { _op: "delete", ID: "1" },
            { _op: "delete", ID: "2" },
            { _op: "insert", ID: "3" },
          ],
        }),
        attachmentsToDelete: undefined,
      };
      const mockedAttachments = ["attachment3", "attachment4"];
      cds.model.definitions["myName.attachments"] = mockedAttachments;
      getURLsToDeleteFromAttachments.mockResolvedValue([
        "attachment3",
        "attachment4",
      ]);
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.diff).toHaveBeenCalled();
      expect(getURLsToDeleteFromAttachments).toHaveBeenCalledWith(
        ["1", "2"],
        mockedAttachments
      );
      expect(mockedReq.attachmentsToDelete).toEqual([
        "attachment3",
        "attachment4",
      ]);
    });

    it("should not add attachmentsToDelete in req when no deletions are present", async () => {
      const mockedReq = {
        query: {
          target: {
            name: "myName",
          },
          user: {
            tokenInfo: {
              getTokenValue: jest.fn().mockReturnValue('tokenValue'),
            },
          },
        },
        diff: jest.fn().mockResolvedValue({
          attachments: [],
        }),
        attachmentsToDelete: undefined,
      };
      const mockedAttachments = ["attachment3", "attachment4"];
      cds.model.definitions["myName.attachments"] = mockedAttachments;
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.diff).toHaveBeenCalled();
      expect(getURLsToDeleteFromAttachments).not.toHaveBeenCalled();
      expect(mockedReq.attachmentsToDelete).toBeUndefined();
    });

    it("should not add attachmentsToDelete in req when no attachments are present", async () => {
      const mockedReq = {
        query: {
          target: {
            name: "myName",
          },user: {
            tokenInfo: {
              getTokenValue: jest.fn().mockReturnValue('tokenValue'),
            },
          },
        },
        diff: jest.fn().mockResolvedValue({
          attachments: [],
        }),
        attachmentsToDelete: undefined,
      };
      const mockedAttachments = [];
      cds.model.definitions["myName.attachments"] = mockedAttachments;
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.diff).toHaveBeenCalled();
      expect(getURLsToDeleteFromAttachments).not.toHaveBeenCalled();
      expect(mockedReq.attachmentsToDelete).toBeUndefined();
    });

    it("attachDeletionData() should set req.parentId if event is DELETE and getFolderIdForEntity() returns non-empty array", async () => {
      const mockReq = {
        query: { target: { name: "testName" },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        }, },
        diff: () =>
          Promise.resolve({ attachments: [{ _op: "delete", ID: "1" }] }),
        event: "DELETE",
      };
     
      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdForEntity.mockResolvedValueOnce([{ folderId: "folder" }]);
      await service.attachDeletionData(mockReq);
      expect(mockReq.parentId).toEqual("folder");
      expect(getFolderIdForEntity).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not set req.parentId if event is DELETE and getFolderIdForEntity() returns empty array", async () => {
      const mockReq = {
        query: { target: { name: "testName" },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        }, },
        diff: () =>
          Promise.resolve({ attachments: [{ _op: "delete", ID: "1" }] }),
        event: "DELETE",
      };
      
      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdForEntity.mockResolvedValueOnce([]);
      await service.attachDeletionData(mockReq);
      expect(mockReq.parentId).toBeUndefined();
      expect(getFolderIdForEntity).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not call getFolderIdForEntity() if event is not DELETE", async () => {
      const mockReq = {
        query: { target: { name: "testName" },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        }, },
        diff: () =>
          Promise.resolve({ attachments: [{ _op: "delete", ID: "1" }] }),
        event: "CREATE",
      };
   
      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      await service.attachDeletionData(mockReq);
      expect(getFolderIdForEntity).toHaveBeenCalledTimes(0);
    });
    it("attachDeletionData() should not proceed if attachments are not defined", async () => {
      const mockReq = {
        query: {
          target: { name: "testName" },
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
        diff: jest
          .fn()
          .mockResolvedValueOnce({ attachments: [{ _op: "delete", ID: "1" }] }),
      };
      // delete the attachments in the definitions
      delete cds.model.definitions[mockReq.query.target.name + ".attachments"];
      await service.attachDeletionData(mockReq);

      // Assuming that these are called inside if(attachments) block
      expect(mockReq.diff).not.toHaveBeenCalled();
      expect(getURLsToDeleteFromAttachments).not.toHaveBeenCalled();
    });

    it("attachDeletionData() should not set req.attachmentsToDelete if there are no attachments to delete", async () => {
      const mockReq = {
        query: { target: { name: "testName" } },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
        diff: () =>
          Promise.resolve({ attachments: [{ _op: "delete", ID: "1" }] }),
      };
      getURLsToDeleteFromAttachments.mockResolvedValueOnce([]); // returning empty array
      await service.attachDeletionData(mockReq);
      expect(mockReq.attachmentsToDelete).toBeUndefined();
    });
  });

  describe("deleteAttachmentsWithKeys", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
    });
    it("should delete attachments if req.attachmentsToDelete has records to delete", async () => {
      const records = []; // Add required records data
      const req = {
        query: { target: { name: "testTarget" } },
        attachmentsToDelete: [
          { url: "test_url1", ID: "1" },
          { url: "test_url2", ID: "2" },
        ],
        info: jest.fn(),
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
      };
     
      const expectedErrorResponse = "test_error_response";

      cds.model.definitions["testTarget.attachments"] = {}; // Add relevant attachment definition
      fetchAccessToken.mockResolvedValue("test_token");
      deleteAttachmentsOfFolder.mockResolvedValue({});
      service.handleRequest = jest
        .fn()
        .mockResolvedValueOnce({ message: expectedErrorResponse, ID: "2" });
      await service.deleteAttachmentsWithKeys(records, req);

      expect(fetchAccessToken).toHaveBeenCalledTimes(1);
      expect(deleteAttachmentsOfFolder).toHaveBeenCalledTimes(2);
      expect(service.handleRequest).toHaveBeenCalledTimes(2);
      expect(req.attachmentsToDelete).toHaveLength(1);
      expect(req.attachmentsToDelete[0].ID).toEqual("1");
      expect(req.info).toHaveBeenCalledWith(200, "\n" + expectedErrorResponse);
    });

    it("should not call fetchAccessToken, deleteAttachmentsOfFolder, and handleRequest methods if req.attachmentsToDelete is empty", async () => {
      const records = [];
      jest.spyOn(service, "handleRequest");
      const req = {
        query: { target: { name: "testTarget" } },
        attachmentsToDelete: [],
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
      };

      await service.deleteAttachmentsWithKeys(records, req);

      expect(fetchAccessToken).not.toHaveBeenCalled();
      expect(deleteAttachmentsOfFolder).not.toHaveBeenCalled();
      expect(service.handleRequest).not.toHaveBeenCalled();
    });

    test("deleteAttachmentsWithKeys() should delete entire folder when parentId is available", async () => {
      const mockReq = {
        query: { target: { name: "testName" } },
        attachmentsToDelete: ["file1", "file2"],
        parentId: "some_folder_id",
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
      };

      fetchAccessToken.mockResolvedValueOnce("mocked_token");
      deleteFolderWithAttachments.mockResolvedValueOnce({});

      await service.deleteAttachmentsWithKeys([], mockReq);

      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'tokenValue');
      expect(deleteFolderWithAttachments).toHaveBeenCalledWith(
        service.creds,
        "mocked_token",
        mockReq.parentId
      );
      expect(deleteAttachmentsOfFolder).not.toHaveBeenCalled();
    });
  });

  describe("onCreate", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });
    it("should return empty array if no attachments fail", async () => {
      const data = [{ ID: 1 }, { ID: 2 }];
      const credentials = {};
      const token = "token";
      const attachments = [];
      const req = { data: { attachments: [...data] },
      user: {
        tokenInfo: {
          getTokenValue: jest.fn().mockReturnValue('tokenValue'),
        },
      }, };

      createAttachment.mockResolvedValue({
        status: 201,
        data: { succinctProperties: { "cmis:objectId": "url" } },
      });

      const result = await service.onCreate(
        data,
        credentials,
        token,
        attachments,
        req,
        createAttachment
      );
      expect(result).toEqual([]);
      expect(req.data.attachments).toHaveLength(2);
    });

    it("should return failed request messages if some attachments fail", async () => {
      const data = [{ ID: 1 }, { ID: 2 }];
      const credentials = {};
      const token = "token";
      const attachments = [];
      const req = { data: { attachments: [...data] } ,
      user: {
        tokenInfo: {
          getTokenValue: jest.fn().mockReturnValue('tokenValue'),
        },
      },};

      createAttachment
        .mockResolvedValueOnce({
          status: 201,
          data: { succinctProperties: { "cmis:objectId": "url" } },
        })
        .mockResolvedValueOnce({
          status: 400,
          response: { data: { message: "Attachment failed" } },
        });

      const result = await service.onCreate(
        data,
        credentials,
        token,
        attachments,
        req,
        createAttachment
      );
      expect(result).toEqual(["Attachment failed"]);
      expect(req.data.attachments).toHaveLength(1);
    });

    it("onCreate() should add error message to failedReq if d.content is null", async () => {
      const mockAttachments = [
        { content: null, filename: "filename1", ID: "id1" },
        { content: "valid_data", filename: "filename2", ID: "id2" },
      ];
      const mockReq = {
        data: { attachments: [...mockAttachments] ,
          user: {
            tokenInfo: {
              getTokenValue: jest.fn().mockReturnValue('tokenValue'),
            },
          },},
      };
      const token = "mocked_token";
      const credentials = "mocked_credentials";
      const attachments = "mocked_attachments";
      const parentId = "mocked_parentId";

      createAttachment.mockResolvedValue({
        status: 201,
        data: { succinctProperties: { "cmis:objectId": "some_object_id" } },
      });

      const failedFiles = await service.onCreate(
        mockAttachments,
        credentials,
        token,
        attachments,
        mockReq,
        parentId
      );

      expect(failedFiles).toEqual([emptyFileErr("filename1")]);
      expect(mockReq.data.attachments).toHaveLength(1);
      expect(mockReq.data.attachments[0]).toEqual({
        content: null,
        filename: "filename2",
        ID: "id2",
        folderId: parentId,
        url: "some_object_id",
      });
    });
  });

  describe("handleRequest", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });
    it("should return nothing when status is 404", async () => {
      const response = { status: 404 };
      const objectId = "1234";

      const result = await service.handleRequest(response, objectId);

      expect(result).toBeUndefined();
    });

    it("should return nothing when status is 200", async () => {
      const response = { status: 200 };
      const objectId = "1234";

      const result = await service.handleRequest(response, objectId);

      expect(result).toBeUndefined();
    });

    it("should return response data when status is not 200 and 404", async () => {
      const response = { status: 500, message: "Internal server error" };
      const objectId = "1234";

      const result = await service.handleRequest(response, objectId);

      expect(result).toEqual({
        ID: objectId,
        message: response.message,
      });
    });

    it("should handle response without a status", async () => {
      const response = {
        response: { status: 500 },
        message: "Internal server error",
      };
      const objectId = "1234";

      const result = await service.handleRequest(response, objectId);

      expect(result).toEqual({
        ID: objectId,
        message: response.message,
      });
    });
  });

  describe("registerUpdateHandlers", () => {
    let mockSrv;
    let service;
    beforeEach(() => {
      mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
      };
      service = new SDMAttachmentsService();
      service.attachDeletionData = jest.fn();
      service.draftSaveHandler = jest.fn();
      service.deleteAttachmentsWithKeys = jest.fn();
    });
    it("should call srv.before for DELETE with correct target and callback", () => {
      service.registerUpdateHandlers(mockSrv, "entity", "target");
      expect(mockSrv.before).toHaveBeenCalledWith(
        ["DELETE", "UPDATE"],
        "entity",
        expect.any(Function)
      );
    });

    it("should call srv.before for SAVE with correct callback", () => {
      service.registerUpdateHandlers(mockSrv, "entity", "target");
      expect(mockSrv.before).toHaveBeenCalledWith(
        "SAVE",
        "entity",
        expect.any(Function)
      );
    });

    it("should call srv.after for DELETE with correct target and callback", () => {
      service.registerUpdateHandlers(mockSrv, "entity", "target");
      expect(mockSrv.after).toHaveBeenCalledWith(
        ["DELETE", "UPDATE"],
        "entity",
        expect.any(Function)
      );
    });
  });
});
