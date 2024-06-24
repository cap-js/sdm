const SDMAttachmentsService = require("../../lib/sdm");
const {
  fetchAccessToken,
  checkAttachmentsToRename 
} = require("../../lib/util");
const {
  getDraftAttachments,
  getURLsToDeleteFromAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
  getExistingAttachments
} = require("../../lib/persistence");
const {
  deleteAttachmentsOfFolder,
  createAttachment,
  readAttachment,
  getFolderIdByPath,
  createFolder,
  deleteFolderWithAttachments,
  renameAttachment
} = require("../../lib/handler");
const {
  duplicateDraftFileErr,
  emptyFileErr,
} = require("../../lib/util/messageConsts");
const { attachment } = require("express/lib/response");

jest.mock("@cap-js/attachments/lib/basic", () => class {});
jest.mock("../../lib/persistence", () => ({
  getDraftAttachments: jest.fn(),
  getDuplicateAttachments: jest.fn(),
  getURLsToDeleteFromAttachments: jest.fn(),
  getURLFromAttachments: jest.fn(),
  getFolderIdForEntity: jest.fn(),
  getExistingAttachments: jest.fn()
}));
jest.mock("../../lib/util", () => ({
  fetchAccessToken: jest.fn(),
  checkAttachmentsToRename: jest.fn()
}));
jest.mock("../../lib/handler", () => ({
  deleteAttachmentsOfFolder: jest.fn(),
  createAttachment: jest.fn(),
  readAttachment: jest.fn(),
  getFolderIdByPath: jest.fn(),
  createFolder: jest.fn(),
  deleteFolderWithAttachments: jest.fn(),
  renameAttachment: jest.fn()
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
      service = new SDMAttachmentsService();
      service.creds = { uri: "mock_cred" };
    });

    it("should interact with DB, fetch access token and readAttachment with correct parameters", async () => {
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
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
      readAttachment.mockResolvedValueOnce("dummy_content");

      await service.get(attachments, keys, req); // call get method

      expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
      expect(fetchAccessToken).toHaveBeenCalledWith(
        service.creds,
        "tokenValue"
      );
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
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
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

      await expect(service.get(attachments, keys, req)).rejects.toThrow(
        "Error reading attachment"
      );

      expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
      expect(fetchAccessToken).toHaveBeenCalledWith(
        service.creds,
        "tokenValue"
      );
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
      jest.resetAllMocks();
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
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
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
    });

    it("should not call onCreate if no draft attachments are available", async () => {
      getDraftAttachments.mockResolvedValueOnce([]);
      const createSpy = jest.spyOn(service, "create");
      await service.draftSaveHandler(mockReq);

      expect(createSpy).not.toBeCalled();
    });

    it("should handle successful create without any issue", async () => {
      //service.isFileNameDuplicate = jest.fn().mockResolvedValueOnce("");
      service.create = jest.fn().mockResolvedValueOnce([]);
      const createSpy = jest.spyOn(service, "create");
      getDraftAttachments.mockResolvedValueOnce([{'HasActiveEntity':false}]);
      checkAttachmentsToRename.mockResolvedValueOnce([]);

      await service.draftSaveHandler(mockReq);

      expect(createSpy).toBeCalled();
    });

    it("should handle successful onRename without any issue", async () => {
      service.rename = jest.fn().mockResolvedValueOnce([]);
      const renameSpy = jest.spyOn(service, "rename");
      getDraftAttachments.mockResolvedValueOnce([
        {
          'ID': 'id1',
          'filename': 'nameprev',
          'HasActiveEntity' : true
        },
        {
          'ID': 'id2',
          'filename': 'samename',
          'HasActiveEntity' : true
        }]);
      checkAttachmentsToRename.mockResolvedValueOnce([{}]);

      await service.draftSaveHandler(mockReq);

      expect(renameSpy).toBeCalled();
    });

    it("should not call rename if no draft attachments are available", async () => {
      getDraftAttachments.mockResolvedValueOnce([]);
      const renameSpy = jest.spyOn(service, "rename");
      await service.draftSaveHandler(mockReq);

      expect(renameSpy).not.toBeCalled();
    });

    it("should call only onCreate if only new attachments are available in draft", async () => {
      service.create = jest.fn().mockResolvedValueOnce([]);
      const createSpy = jest.spyOn(service, "create");
      const renameSpy = jest.spyOn(service, "rename");
      getDraftAttachments.mockResolvedValueOnce([{'HasActiveEntity' : false}]);
      checkAttachmentsToRename.mockResolvedValueOnce([]);
      
      await service.draftSaveHandler(mockReq);

      expect(createSpy).toBeCalled();
      expect(renameSpy).not.toBeCalled();
    });

    it("should call only onRename if only modified attachments are available in draft", async () => {
      service.rename = jest.fn().mockResolvedValueOnce([]);
      const createSpy = jest.spyOn(service, "create");
      const renameSpy = jest.spyOn(service, "rename");
      getDraftAttachments.mockResolvedValueOnce([
        {
          'ID': 'id',
          'filename': 'nameprev',
          'HasActiveEntity' : true
        }]);
      checkAttachmentsToRename.mockResolvedValueOnce([{}]);
      
      await service.draftSaveHandler(mockReq);

      expect(createSpy).not.toBeCalled();
      expect(renameSpy).toBeCalled();
    });

    it("should call both onRename and onCreate if both modified and new attachments are available in draft", async () => {
      service.rename = jest.fn().mockResolvedValueOnce([]);
      service.create = jest.fn().mockResolvedValueOnce([]);
      const createSpy = jest.spyOn(service, "create");
      const renameSpy = jest.spyOn(service, "rename");
      getDraftAttachments.mockResolvedValueOnce([
        {
          'ID': 'id',
          'filename': 'nameprev',
          'HasActiveEntity' : true
        },
        {
          'HasActiveEntity' : false
        }]);
      checkAttachmentsToRename.mockResolvedValueOnce([{}]);
      
      await service.draftSaveHandler(mockReq);

      expect(createSpy).toBeCalled();
      expect(renameSpy).toBeCalled();
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
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        diff: jest.fn().mockResolvedValueOnce({
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
      getURLsToDeleteFromAttachments.mockResolvedValueOnce([
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
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        diff: jest.fn().mockResolvedValueOnce({
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
          },
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        diff: jest.fn().mockResolvedValueOnce({
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
        query: { target: { name: "testName" } },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        diff: () =>
          Promise.resolve({ attachments: [{ _op: "delete", ID: "1" }] }),
        event: "DELETE",
      };

      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdByPath.mockResolvedValueOnce("folder");
      await service.attachDeletionData(mockReq);
      expect(mockReq.parentId).toEqual("folder");
      expect(getFolderIdByPath).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not set req.parentId if event is DELETE and getFolderIdForEntity() returns empty array", async () => {
      const mockReq = {
        query: {
          target: { name: "testName" },
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        diff: () =>
          Promise.resolve({ attachments: [{ _op: "delete", ID: "1" }] }),
        event: "DELETE",
      };

      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdByPath.mockResolvedValueOnce(null);
      await service.attachDeletionData(mockReq);
      expect(mockReq.parentId).toBeUndefined();
      expect(getFolderIdByPath).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not call getFolderIdForEntity() if event is not DELETE", async () => {
      const mockReq = {
        query: {
          target: { name: "testName" },
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
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
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
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
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
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
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };

      const expectedErrorResponse = "test_error_response";

      cds.model.definitions["testTarget.attachments"] = {}; // Add relevant attachment definition
      fetchAccessToken.mockResolvedValueOnce("test_token");
      deleteAttachmentsOfFolder.mockResolvedValueOnce({});
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

    it("should not call deleteAttachmentsOfFolder, and handleRequest methods if req.attachmentsToDelete is empty", async () => {
      const records = [];
      jest.spyOn(service, "handleRequest");
      const req = {
        query: { target: { name: "testTarget" } },
        attachmentsToDelete: [],
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      fetchAccessToken.mockResolvedValueOnce("test_token");

      await service.deleteAttachmentsWithKeys(records, req);
      expect(deleteAttachmentsOfFolder).not.toHaveBeenCalled();
      expect(service.handleRequest).not.toHaveBeenCalled();
    });

    it("deleteAttachmentsWithKeys() should delete entire folder when parentId is available", async () => {
      const mockReq = {
        query: { target: { name: "testName" } },
        attachmentsToDelete: ["file1", "file2"],
        parentId: "some_folder_id",
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };

      fetchAccessToken.mockResolvedValueOnce("mocked_token");
      deleteFolderWithAttachments.mockResolvedValueOnce({});

      await service.deleteAttachmentsWithKeys([], mockReq);

      expect(fetchAccessToken).toHaveBeenCalledWith(
        service.creds,
        "tokenValue"
      );
      expect(deleteFolderWithAttachments).toHaveBeenCalledWith(
        service.creds,
        "mocked_token",
        mockReq.parentId
      );
      expect(deleteAttachmentsOfFolder).not.toHaveBeenCalled();
    });
    it("should call deleteFolderWithAttachments when there is parentId and attachmentsToDelete is empty", async () => {
      const service = new SDMAttachmentsService();
      const records = [];
      const req = {
        query: { target: { name: "testTarget" } },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        parentId: "1234",
        attachmentsToDelete: [],
      };

      fetchAccessToken.mockResolvedValueOnce("GeneratedToken");
      deleteFolderWithAttachments.mockResolvedValueOnce({});

      await service.deleteAttachmentsWithKeys(records, req);

      expect(fetchAccessToken).toHaveBeenCalledTimes(1);
      expect(deleteFolderWithAttachments).toHaveBeenCalledTimes(1);
      expect(deleteFolderWithAttachments).toHaveBeenCalledWith(
        service.creds,
        "GeneratedToken",
        req.parentId
      );
    });
  });

  describe("create", () => {
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
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
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

    it("should call onCreate without any issue", async () => {
      const attachment_val_create = [{}];
      const token = "token";
      const attachments = [];
      const req = {};

      service.getParentId = jest.fn().mockResolvedValueOnce("parentId");
      service.onCreate = jest.fn().mockResolvedValueOnce([]);
      const getParentIdSpy = jest.spyOn(service, "getParentId");
      const onCreateSpy = jest.spyOn(service, "onCreate");

      await service.create(
        attachment_val_create,
        attachments,
        req,
        token
      );
      
      expect(onCreateSpy).toBeCalled();
      expect(getParentIdSpy).toBeCalled();
      expect(mockReq.info).not.toBeCalled();
    })

    it("should handle failure in onCreate", async () => {
      const attachment_val_create = [{}];
      const token = "token";
      const attachments = [];

      service.getParentId = jest.fn().mockResolvedValueOnce("parentId");
      service.onCreate = jest.fn().mockResolvedValue(["ChildTest"]);

      await service.create(
        attachment_val_create,
        attachments,
        mockReq,
        token
      );

      expect(mockReq.info).toHaveBeenCalledWith(200, "\nAttachment with name Test");
    })
  });

  describe("rename", () => {
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
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
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

    it("should call onRename without any issue", async () => {
      const token = "token";
      const modifiedAttachments = [];

      service.onRename = jest.fn().mockResolvedValueOnce([]);
      const onRenameSpy = jest.spyOn(service, "onRename");

      await service.rename(
        modifiedAttachments,
        token,
        mockReq
      );
      
      expect(onRenameSpy).toBeCalled();
      expect(mockReq.info).not.toBeCalled();
    })

    it("should handle failure in onRename", async () => {
      const token = "token";
      const modifiedAttachments = [];

      service.onRename = jest.fn().mockResolvedValue(["ChildTest"]);

      await service.rename(
        modifiedAttachments,
        token,
        mockReq
      );

      expect(mockReq.info).toHaveBeenCalledWith(200, "\nAttachment with name Test");
    })
  });

  describe("onCreate", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });

    it("should return failed request messages if some attachments fail", async () => {
      const data = [{ ID: 1 }, { ID: 2 }];
      const credentials = {};
      const token = "token";
      const attachments = [];
      const req = {
        data: { attachments: [...data] },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };

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

    it("should return empty array if no attachments fail", async () => {
      const data = [{ ID: 1 }];
      const credentials = {};
      const token = "token";
      const attachments = [];
      const req = {
        data: { attachments: [...data] },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };

      createAttachment
        .mockResolvedValueOnce({
          status: 201,
          data: { succinctProperties: { "cmis:objectId": "url" } },
        })

      const result = await service.onCreate(
        data,
        credentials,
        token,
        attachments,
        req,
        createAttachment
      );
      expect(result).toEqual([]);
    });

    it("onCreate() should add error message to failedReq if d.content is null", async () => {
      const mockAttachments = [
        { content: null, filename: "filename1", ID: "id1" },
        { content: "valid_data", filename: "filename2", ID: "id2" },
      ];
      const mockReq = {
        data: {
          attachments: [...mockAttachments],
          user: {
            tokenInfo: {
              getTokenValue: jest.fn().mockReturnValue("tokenValue"),
            },
          },
        },
      };
      const token = "mocked_token";
      const credentials = "mocked_credentials";
      const attachments = "mocked_attachments";
      const parentId = "mocked_parentId";

      createAttachment.mockResolvedValueOnce({
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

  describe("onRename", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });
    it("should return empty array if no attachments fail", async () => {
      const modifiedAttachments = [{name:"name"}];
      const credentials = {};
      const token = "token";

      renameAttachment.mockResolvedValueOnce({
        status: 200,
        response : {
          data: {
            message: 'error'
          }
        }
      });

      const result = await service.onRename(
        modifiedAttachments,
        credentials,
        token,
      );
      expect(result).toEqual([]);
    });

    it("should return an error if name is empty", async () => {
      const modifiedAttachments = [{ name: "" }];
      const credentials = {};
      const token = "token";
    
      await expect(service.onRename(modifiedAttachments, credentials, token))
        .rejects
        .toThrow("Filename cannot be empty");
    
      expect(renameAttachment).toHaveBeenCalledTimes(0);
    });

    it("should return failed request messages if rename fails for some attachments", async () => {
      const modifiedAttachments = [{ name: "attachment#1", id:"id1" }, { name: "attachment#2", id:"id2" }];
      const credentials = {};
      const token = "token";
      const req = {
        data: {
          attachments: [
            {
              id: "id1",
              filename: "attachment#1"
            },
            {
              id: "id2",
              filename: "attachment#2"
            }
          ]
        }
      }
    
      renameAttachment
        .mockResolvedValueOnce({
          status: 200,
          data: { succinctProperties: { "cmis:objectId": "url" } },
        })
        .mockResolvedValueOnce({
          response: { data: { message: "Rename failed" } , status: 400},
        });

      const result = await service.onRename(
        modifiedAttachments,
        credentials,
        token,
        req
      );
      expect(result).toEqual(["Rename failed"]);
    });
  });

  describe("getParentId", () => {
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
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
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

    it("getParentId should call getFolderIdByPath if getFolderIdForEntity returns empty array", async () => {
      attachments = cds.model.definitions[mockReq.query.target.name + ".attachments"]
      token = "mocked_token"
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce("mocked_folder_id");

      await service.getParentId(attachments,mockReq,token)
 
      expect(getFolderIdByPath).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        "mocked_token",
        cds.model.definitions[mockReq.query.target.name + ".attachments"]
      );
    });
  
    it("getParentId should call createFolder if getFolderIdForEntity and getFolderIdByPath return empty", async () => {
      attachments = cds.model.definitions[mockReq.query.target.name + ".attachments"]
      token = "mocked_token"
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce(null);
      createFolder.mockResolvedValueOnce(
        {
          data: {
            succinctProperties: {
              "cmis:objectId": "mock_object_id"
            }
          }
        }
      );

      await service.getParentId(attachments,mockReq,token)
 
      expect(createFolder).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        "mocked_token",
        cds.model.definitions[mockReq.query.target.name + ".attachments"]
      );
    });
  
    it("Success in getParentId", async () => {
      attachments = cds.model.definitions[mockReq.query.target.name + ".attachments"]
      token = "mocked_token"
      getFolderIdForEntity.mockResolvedValueOnce(["folderId"]);

      await service.getParentId(attachments,mockReq,token)
 
      expect(getFolderIdForEntity).toHaveBeenCalledWith(
        cds.model.definitions[mockReq.query.target.name + ".attachments"],
        mockReq
      );
    });  
  });

  describe("isFileNameDuplicateInDrafts", () => {
    let service;
    let mockReq;
    let cds;
    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
      mockReq = {
        query: {
          target: {
            name: "testName",
          },
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
          },
        },
        reject: jest.fn(),
        info: jest.fn(),
      };
    });

    it("Duplicate file case", async () => {
      const duplicateErrMsg = "same_name";
      data = [
        {
          filename : "same_name"
        },
        {
          filename : "same_name"
        }
      ]

      await service.isFileNameDuplicateInDrafts(data,mockReq)
      
      expect(mockReq.reject).toHaveBeenCalledWith(
        409,
        duplicateDraftFileErr(duplicateErrMsg)
      );
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
