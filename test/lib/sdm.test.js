const SDMAttachmentsService = require("../../lib/sdm");
const getDraftAttachments =
  require("../../lib/persistence").getDraftAttachments;
const getDuplicateAttachments =
  require("../../lib/persistence").getDuplicateAttachments;
const getURLsToDeleteFromAttachments =
  require("../../lib/persistence").getURLsToDeleteFromAttachments;
const getURLFromAttachments =
  require("../../lib/persistence").getURLFromAttachments;
const fetchAccessToken = require("../../lib/util").fetchAccessToken;
const deleteAttachment = require("../../lib/handler").deleteAttachment;
const createAttachment = require("../../lib/handler").createAttachment;
const readAttachment = require("../../lib/handler").readAttachment;
const readDocument = require("../../lib/handler").readDocument;
const { duplicateFileErr } = require("../../lib/util/messageConsts");

jest.mock("@cap-js/attachments/lib/basic", () => class {});
jest.mock("../../lib/persistence", () => ({
  getDraftAttachments: jest.fn(),
  getDuplicateAttachments: jest.fn(),
  getURLsToDeleteFromAttachments: jest.fn(),
  getURLFromAttachments: jest.fn()
}));
jest.mock("../../lib/util", () => ({
  fetchAccessToken: jest.fn(),
}));
jest.mock("../../lib/handler", () => ({
  deleteAttachment: jest.fn(),
  createAttachment: jest.fn(),
  readAttachment: jest.fn(),
  readDocument: jest.fn()
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
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const token = "dummy_token";
      const response = {url:'mockUrl'}
  
      fetchAccessToken.mockResolvedValueOnce(token);
      getURLFromAttachments.mockResolvedValueOnce(response)
  
      await service.get(attachments, keys);
    
      expect(getURLFromAttachments).toHaveBeenCalledWith(keys,attachments)
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds);
      expect(readAttachment).toHaveBeenCalledWith("mockUrl", token, service.creds);
    });
  
    it("should throw an error if the url is not found", async () => {
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const token = "dummy_token";
    
      getURLFromAttachments.mockResolvedValueOnce({})
      fetchAccessToken.mockResolvedValueOnce(token);
    
      try {
        await service.get(attachments, keys);
      } catch(e) {
        expect(e).toBeInstanceOf(Error);
        expect(e).toHaveProperty('message', 'Error: Url not found');
      }
    
      expect(getURLFromAttachments).toHaveBeenCalledWith(keys,attachments)
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds);
    });
  });
  describe("draftSaveHandler", () => {
    let service;
    let mockReq;
    let cds;
    beforeEach(() => {
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
      service.creds = { uaa: "mocked uaa" };
      mockReq = {
        query: {
          target: {
            name: "testName",
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

    it("should reject if duplicates exist", async () => {
      getDraftAttachments.mockResolvedValue([{ id: 1 }, { id: 2 }]);
      service.onCreate = jest.fn().mockResolvedValue([]);
      service.isFileNameDuplicate = jest.fn().mockResolvedValue("error");
      await service.draftSaveHandler(mockReq);
      expect(mockReq.reject).toHaveBeenCalledWith(
        409,
        duplicateFileErr("error")
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
  });

  describe("isFileNameDuplicate", () => {
    let service;
    beforeEach(() => {
      service = new SDMAttachmentsService();
    });

    it("should detect duplicates", async () => {
      const attachments = [
        /* array of attachment objects */
      ];
      const attachment_val = [{ filename: "file1" }, { filename: "file2" }];
      getDuplicateAttachments.mockResolvedValue([{ filename: "file1" }]);

      const result = await service.isFileNameDuplicate(
        attachment_val,
        attachments
      );

      expect(result).toBe("file1");
    });

    it("should return empty string if no duplicates", async () => {
      const attachments = [
        /* array of attachment objects */
      ];
      const attachment_val = [{ filename: "file1" }, { filename: "file2" }];
      getDuplicateAttachments.mockResolvedValue([]);

      const result = await service.isFileNameDuplicate(
        attachment_val,
        attachments
      );

      expect(result).toBe("");
    });

    it("should concatenate multiple duplicates", async () => {
      const attachments = [
        /* array of attachment objects */
      ];
      const attachment_val = [{ filename: "file1" }, { filename: "file2" }];
      getDuplicateAttachments.mockResolvedValue([
        { filename: "file1" },
        { filename: "file2" },
      ]);

      const result = await service.isFileNameDuplicate(
        attachment_val,
        attachments
      );

      expect(result).toBe("file1,file2");
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
  });

  describe("attachDeletionData", () => {
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
      };
      const expectedErrorResponse = "test_error_response";

      cds.model.definitions["testTarget.attachments"] = {}; // Add relevant attachment definition
      fetchAccessToken.mockResolvedValue("test_token");
      deleteAttachment.mockResolvedValue({});
      service.handleRequest = jest
        .fn()
        .mockResolvedValueOnce({ message: expectedErrorResponse, ID: "2" });

      await service.deleteAttachmentsWithKeys(records, req);

      expect(fetchAccessToken).toHaveBeenCalledTimes(1);
      expect(deleteAttachment).toHaveBeenCalledTimes(2);
      expect(service.handleRequest).toHaveBeenCalledTimes(2);
      expect(req.attachmentsToDelete).toHaveLength(1);
      expect(req.attachmentsToDelete[0].ID).toEqual("1");
      expect(req.info).toHaveBeenCalledWith(200, "\n" + expectedErrorResponse);
    });

    it("should not call fetchAccessToken, deleteAttachment, and handleRequest methods if req.attachmentsToDelete is empty", async () => {
      const records = [];
      jest.spyOn(service, "handleRequest");
      const req = {
        query: { target: { name: "testTarget" } },
        attachmentsToDelete: [],
      };

      await service.deleteAttachmentsWithKeys(records, req);

      expect(fetchAccessToken).not.toHaveBeenCalled();
      expect(deleteAttachment).not.toHaveBeenCalled();
      expect(service.handleRequest).not.toHaveBeenCalled();
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
      const req = { data: { attachments: [...data] } };

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
      const req = { data: { attachments: [...data] } };

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
