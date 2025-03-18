const SDMAttachmentsService = require("../../lib/sdm");
const NodeCache = require("node-cache");
const {
  fetchAccessToken,
  checkAttachmentsToRename,
  getConfigurations,
  isRepositoryVersioned,
  getClientCredentialsToken,
  isRestrictedCharactersInName
} = require("../../lib/util");
const {
  getDraftAttachments,
  getDraftAttachmentsForUpID,
  getURLsToDeleteFromAttachments,
  getURLsToDeleteFromDraftAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
  updateAttachmentInDraft,
  setRepositoryId
} = require("../../lib/persistence");
const {
  deleteAttachmentsOfFolder,
  createAttachment,
  readAttachment,
  getFolderIdByPath,
  createFolder,
  deleteFolderWithAttachments,
  getAttachment,
  renameAttachment,
  getRepositoryInfo
} = require("../../lib/handler");
const {
  duplicateDraftFileErr,
  virusFileErr,
  duplicateFileErr,
  otherFileErr,
  userNotAuthorisedError,
  userDoesNotHaveRequiredScope,
  versionedRepositoryErr,
  nameConstrainErr,
  renameFileErr,
  renameOtherFilesErr
} = require("../../lib/util/messageConsts");

jest.mock("@cap-js/attachments/lib/basic", () => class {});
jest.mock("../../lib/persistence", () => ({
  getDraftAttachments: jest.fn(),
  getDraftAttachmentsForUpID: jest.fn(),
  getDuplicateAttachments: jest.fn(),
  getURLsToDeleteFromAttachments: jest.fn(),
  getURLsToDeleteFromDraftAttachments: jest.fn(),
  getURLFromAttachments: jest.fn(),
  getFolderIdForEntity: jest.fn(),
  updateAttachmentInDraft: jest.fn(),
  getExistingAttachments: jest.fn(),
  setRepositoryId: jest.fn()
}));
jest.mock("../../lib/util", () => ({
  fetchAccessToken: jest.fn(),
  checkAttachmentsToRename: jest.fn(),
  getConfigurations: jest.fn(),
  isRepositoryVersioned: jest.fn(),
  getClientCredentialsToken: jest.fn(),
  isRestrictedCharactersInName: jest.fn()
}));
jest.mock("../../lib/handler", () => ({
  deleteAttachmentsOfFolder: jest.fn(),
  createAttachment: jest.fn(),
  readAttachment: jest.fn(),
  getFolderIdByPath: jest.fn(),
  createFolder: jest.fn(),
  deleteFolderWithAttachments: jest.fn(),
  getAttachment: jest.fn(),
  renameAttachment: jest.fn(),
  getRepositoryInfo: jest.fn()
}));
jest.mock("@sap/cds/lib", () => {
  const mockCds = {
    model: {
      definitions: {},
    },
  };
  return mockCds;
});
jest.mock("node-cache");

describe("SDMAttachmentsService", () => {
  describe("checkRepositoryType", () => {
    let service;
    let cache;
    let cds;
  
    beforeEach(() => {
      cds = require("@sap/cds/lib");
      cache = new NodeCache();
      NodeCache.mockImplementation(() => cache);
      service = new SDMAttachmentsService();
      service.creds = { clientId: "client-id", clientSecret: "client-secret" };
    });
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it("should fetch repository info and check versioned status if not found in cache", async () => {
      const mockReq = { reject: jest.fn() };
      cds.context = {
        user: {
          tokenInfo: {
            getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
          }
        }
      };
  
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      cache.get.mockReturnValue(undefined);
      getClientCredentialsToken.mockResolvedValue("mock-token");
      getRepositoryInfo.mockResolvedValue({ data: "mock-repo-info" });
      isRepositoryVersioned.mockResolvedValue(false);
  
      await service.checkRepositoryType(mockReq);
  
      expect(getClientCredentialsToken).toHaveBeenCalledWith(service.creds);
      expect(getRepositoryInfo).toHaveBeenCalledWith(service.creds, "mock-token");
      expect(isRepositoryVersioned).toHaveBeenCalledWith({ data: "mock-repo-info" }, "repo123");
      expect(mockReq.reject).not.toHaveBeenCalled();
    });
  
    it("should reject the request if the repository is versioned", async () => {
      const mockReq = { reject: jest.fn() };
      cds.context = {
        user: {
          tokenInfo: {
            getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
          }
        }
      };
  
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      cache.get.mockReturnValue(undefined);
      getClientCredentialsToken.mockResolvedValue("mock-token");
      getRepositoryInfo.mockResolvedValue({ data: "mock-repo-info" });
      isRepositoryVersioned.mockResolvedValue(true);
  
      await service.checkRepositoryType(mockReq);
  
      expect(getClientCredentialsToken).toHaveBeenCalledWith(service.creds);
      expect(getRepositoryInfo).toHaveBeenCalledWith(service.creds, "mock-token");
      expect(isRepositoryVersioned).toHaveBeenCalledWith({ data: "mock-repo-info" }, "repo123");
      expect(mockReq.reject).toHaveBeenCalledWith(400, versionedRepositoryErr);
    });
  });

  describe("Test get method", () => {
    let service;
    let repoInfo
    const token = "mocked_token";
    const clientCredentialToken = "mocked_client_credential_token";
    beforeEach(() => {

      NodeCache.prototype.get.mockClear();
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { uri: "mock_cred" };
      repoInfo = {
        data: {
          "123": {
            capabilities: {
              "capabilityContentStreamUpdatability": "pwconly"
            }
          }
        }
      }
      NodeCache.prototype.get.mockImplementation(() => undefined);
      getConfigurations.mockResolvedValueOnce({repositoryId: "123"});
      getRepositoryInfo.mockResolvedValueOnce(repoInfo);
      isRepositoryVersioned.mockResolvedValue(false);
      fetchAccessToken.mockResolvedValue(token);
      getClientCredentialsToken.mockResolvedValue(clientCredentialToken);
    });

    it("should interact with DB, fetch access token and readAttachment with correct parameters", async () => {
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      let cds = require("@sap/cds/lib");
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
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const response = { url: "mockUrl" };

      // set req in service instance
      getURLFromAttachments.mockResolvedValueOnce(response);
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
      let cds = require("@sap/cds/lib");
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
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const response = { url: "mockUrl" };
      const errorMessage = new Error("Attachment not found in the repository");
      errorMessage.code = 404;
    
      getURLFromAttachments.mockResolvedValueOnce(response);
      fetchAccessToken.mockResolvedValueOnce("mockToken");
      readAttachment.mockImplementationOnce(() => {
        throw errorMessage;
      });
  
      await expect(service.get(attachments, keys, req)).rejects.toThrow(
        errorMessage
      );
  
      expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
      expect(fetchAccessToken).toHaveBeenCalledWith(
        service.creds,
        "tokenValue"
      );
      expect(readAttachment).toHaveBeenCalledWith(
        "mockUrl",
        "mockToken", // Passing the mocked token value
        service.creds
      );
    });

    it("should interact with DB, fetch access token and readAttachment with correct parameters when cache returns non-versioned repo type", async () => {
      NodeCache.prototype.get.mockImplementation(() => "non-versioned");
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      let cds = require("@sap/cds/lib");
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
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const response = { url: "mockUrl" };

      // set req in service instance
      getURLFromAttachments.mockResolvedValueOnce(response);
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
  });

  describe('renameHandler', () => {
    let service;
    let req;
    let token;
  
    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      service.creds = {
        uri: 'sampleUri'
      };
      req = {
        query: {
          target: {
            name: 'sampleTarget'
          }
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('sampleTokenValue')
          }
        },
        warn: jest.fn()
      };
      token = 'sampleAccessToken';
    });
  
    it('should rename modified attachments', async () => {
      service.checkRepositoryType = jest.fn().mockResolvedValue();
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.getAttachementDataInSDM = jest.fn((uri, token, objectId) => {
        if (objectId === 'url2') {
          return { filename: 'sampleFileName', folderId: 'sampleFolderId' };
        }
        return { filename: 'prevFile1', folderId: 'sampleFolderId' };
      });
      service.rename = jest.fn().mockResolvedValue('error occurred');
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue([
        { ID: 1, HasActiveEntity: true, filename: 'file1', url: 'url1' },
        { ID: 2, HasActiveEntity: false, filename: 'fileDraft', url: 'url2' }
      ]);
      checkAttachmentsToRename.mockResolvedValue([{ ID: 1, url: 'url1', name: 'file1', prevname: 'prevFile1', folderId: 'sampleFolderId' }]);
  
      await service.renameHandler(req);
  
      expect(service.checkRepositoryType).toHaveBeenCalledWith(req);
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalled();
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'sampleTokenValue');
      expect(getDraftAttachments).toHaveBeenCalledWith(cds.model.definitions['sampleTarget.attachments'], req, undefined);
      expect(service.getAttachementDataInSDM).toHaveBeenCalledWith(service.creds.uri, token, 'url2');
      expect(checkAttachmentsToRename).toHaveBeenCalled();
      expect(service.rename).toHaveBeenCalledWith(
        [{ ID: 1, url: 'url1', name: 'file1', prevname: 'prevFile1', folderId: 'sampleFolderId' },
        { ID: 2, url: 'url2', name: 'fileDraft', prevname: 'sampleFileName', folderId: 'sampleFolderId' }],
        token,
        req
      );
      expect(req.warn).toHaveBeenCalledWith(500, 'error occurred');
    });
  
    it('should not rename if no attachments are modified', async () => {
      service.checkRepositoryType = jest.fn().mockResolvedValue();
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'fileDraft', folderId: 'folderId' });
      service.rename = jest.fn();
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue([]);
      checkAttachmentsToRename.mockResolvedValue([]);
  
      await service.renameHandler(req);
  
      expect(service.checkRepositoryType).toHaveBeenCalledWith(req);
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(fetchAccessToken).not.toHaveBeenCalled();
      expect(getDraftAttachments).toHaveBeenCalledWith(cds.model.definitions['sampleTarget.attachments'], req, undefined);
      expect(service.getAttachementDataInSDM).not.toHaveBeenCalled();
      expect(checkAttachmentsToRename).not.toHaveBeenCalled();
      expect(service.rename).not.toHaveBeenCalled();
      expect(req.warn).not.toHaveBeenCalled();
    });

    it('should not modify attachments if filenameInDraft equals filenameInSDM', async () => {
      service.checkRepositoryType = jest.fn().mockResolvedValue();
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'fileDraft', folderId: 'sampleFolderId' });
      service.rename = jest.fn().mockResolvedValue('');
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue([
        { ID: 1, HasActiveEntity: true, filename: 'file1', url: 'url1' },
        { ID: 2, HasActiveEntity: false, filename: 'fileDraft', url: 'url2' }
      ]);
      checkAttachmentsToRename.mockResolvedValue([]);
  
      await service.renameHandler(req);
  
      expect(service.checkRepositoryType).toHaveBeenCalledWith(req);
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalled();
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'sampleTokenValue');
      expect(getDraftAttachments).toHaveBeenCalledWith(cds.model.definitions['sampleTarget.attachments'], req, undefined);
      expect(service.getAttachementDataInSDM).toHaveBeenCalledWith(service.creds.uri, token, 'url2');
      expect(checkAttachmentsToRename).toHaveBeenCalled();
      expect(req.warn).not.toHaveBeenCalled();
    });

    it('should avoid renaming if there are no modified attachments', async () => {
      service.checkRepositoryType = jest.fn().mockResolvedValue();
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'fileDraft', folderId: 'sampleFolderId' });
      service.rename = jest.fn().mockResolvedValue('');
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue([
        { ID: 1, HasActiveEntity: true, filename: 'file1', url: 'url1' }
      ]);
      checkAttachmentsToRename.mockResolvedValue([]);
  
      await service.renameHandler(req);
  
      expect(service.checkRepositoryType).toHaveBeenCalledWith(req);
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalled();
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'sampleTokenValue');
      expect(checkAttachmentsToRename).toHaveBeenCalled();
      expect(service.rename).not.toHaveBeenCalled();
      expect(req.warn).not.toHaveBeenCalled();
    });

    it("should throw correct error message for all rename scenarios in DI", async () => {
      service.rename = jest.fn().mockResolvedValueOnce([]);
      const renameSpy = jest.spyOn(service, "rename");
      getDraftAttachments.mockResolvedValueOnce([
        {
          'ID': 'id1',
          'filename': 'attachment1',
          'HasActiveEntity' : true
        },
        {
          'ID': 'id2',
          'filename': 'attachment2',
          'HasActiveEntity' : true
        },
        {
          'ID': 'id3',
          'filename': 'attachment3',
          'HasActiveEntity' : true
        },
      ]);
      const modifiedAttachments = [
        {
          ID: 'id1',
          url: 'url1',
          name: 'attachment1new',
          prevname: 'attachment1',
          folderId: 'folder1'
        },
        {
          ID: 'id2',
          url: 'url2',
          name: 'attachment2new',
          prevname: 'attachment2',
          folderId: 'folder1'
        },
        {
          ID: 'id3',
          url: 'url3',
          name: 'attachment3new',
          prevname: 'attachment3',
          folderId: 'folder1'
        }
      ];
      checkAttachmentsToRename.mockResolvedValueOnce(modifiedAttachments);
      renameAttachment
        .mockResolvedValueOnce({
          status: 404,
          message: "File not found"
        })
        .mockResolvedValueOnce({
          status: 409,
          message: "File already exists"
        })
        .mockResolvedValueOnce({
          status: 403,
          message: "Unauthorized"
        })
      await service.renameHandler(req);

      expect(renameSpy).toBeCalled();
    });
  });

  describe('getAttachementDataInSDM', () => {
    let service;
    const uri = 'someUri';
    const token = 'someToken';
    const objectId = 'someObjectId';

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    it('should return formatted attachment data correctly', async () => {
      // Arrange
      const mockResponse = {
        data: {
          succinctProperties: {
            'cmis:name': 'testFileName.docx',
            'sap:parentIds': ['parentId123'],
          },
        },
      };
      getAttachment.mockResolvedValue(mockResponse);
  
      // Act
      const result = await service.getAttachementDataInSDM(uri, token, objectId);
  
      // Assert
      expect(result).toEqual({
        filename: 'testFileName.docx',
        folderId: 'parentId123',
      });
    });
  
    it('should throw an error if getAttachment throws an error', async () => {
      // Arrange
      const mockError = new Error('Some error');
      getAttachment.mockRejectedValue(mockError);
  
      // Act & Assert
      await expect(service.getAttachementDataInSDM(uri, token, objectId)).rejects.toThrow('Some error');
    });
  
    it('should return undefined folderId if parentIds array is empty', async () => {
      // Arrange
      const mockResponse = {
        data: {
          succinctProperties: {
            'cmis:name': 'testFileName.docx',
            'sap:parentIds': [],
          },
        },
      };
      getAttachment.mockResolvedValue(mockResponse);
  
      // Act
      const result = await service.getAttachementDataInSDM(uri, token, objectId);
  
      // Assert
      expect(result).toEqual({
        filename: 'testFileName.docx',
        folderId: undefined,
      });
    });
  });

  describe('draftSaveHandler', () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      service.checkRepositoryType = jest.fn();
      service.isFileNameDuplicateInDrafts = jest.fn();
      service.create = jest.fn();
      service.creds = {};
    });
  
    afterEach(() => {
      jest.clearAllMocks();
    });
  
    test('should skip when req.data.content is not provided', async () => {
      const req = { data: {} };
      await service.draftSaveHandler(req);
      expect(service.checkRepositoryType).not.toHaveBeenCalled();
    });
  
    test('should handle drafts when attachment values are found', async () => {
      const draftAttachments = [];
      const req = { data: { content: 'some content', ID: '12345' }, target: draftAttachments, user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } } };
      const token = 'token123';
      const attachment_val = [
        { HasActiveEntity: false, ID: '12345' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      fetchAccessToken.mockResolvedValue(token);
  
      await service.draftSaveHandler(req);
      
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(attachment_val, req);
      expect(service.create).toHaveBeenCalledWith([{ ...attachment_val[0], content: 'some content' }], draftAttachments, req, token);
      expect(req.data.content).toBeNull();
    });
  
    test('should not create attachment if no matching inactive entities are found', async () => {
      const draftAttachments = [];
      const req = { data: { content: 'some content', ID: '12345' }, target: draftAttachments, user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } } };
      const token = 'token123';
      const attachment_val = [{ HasActiveEntity: true, ID: '12345' }];
  
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      fetchAccessToken.mockResolvedValue(token);
  
      await service.draftSaveHandler(req);
  
      expect(service.create).not.toHaveBeenCalled();
      expect(req.data.content).toBeNull();
    });

    test('should skip when no attachments are found', async () => {
      const draftAttachments = [];
      const req = { data: { content: 'some content', ID: '12345' }, target: draftAttachments, user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } } };
      const attachment_val = [];
  
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
  
      await service.draftSaveHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(req.data.content).toBeNull();
    });

    test('should skip processing when req.data.content is null after initial check', async () => {
      const draftAttachments = [];
      const req = { data: { content: null, ID: '12345' }, target: draftAttachments, user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } } };
      const attachment_val = [
        { HasActiveEntity: false, ID: '12345' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
  
      req.data.content = null; // simulating content being reset to null after initial check
  
      await service.draftSaveHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
    });
    test('should reject when filename contains restricted characters', async () => {
      const draftAttachments = [];
      const req = { data: { content: 'some content', ID: '12345' }, target: draftAttachments, user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } }, reject: jest.fn() };
      const token = 'token123';
      const attachment_val = [
        { HasActiveEntity: false, ID: '12345', filename: 'invalid/name' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      fetchAccessToken.mockResolvedValue(token);
      isRestrictedCharactersInName.mockReturnValue(true);
  
      await service.draftSaveHandler(req);
  
      expect(req.reject).toHaveBeenCalledWith(409, nameConstrainErr(['invalid/name'], "Upload"));
    });
  
    test('should not reject when filename does not contain restricted characters', async () => {
      const draftAttachments = [];
      const req = { data: { content: 'some content', ID: '12345' }, target: draftAttachments, user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } }, reject: jest.fn() };
      const token = 'token123';
      const attachment_val = [
        { HasActiveEntity: false, ID: '12345', filename: 'validname' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      fetchAccessToken.mockResolvedValue(token);
      isRestrictedCharactersInName.mockReturnValue(false);
  
      await service.draftSaveHandler(req);
  
      expect(req.reject).not.toHaveBeenCalled();
      expect(service.create).toHaveBeenCalledWith([{ ...attachment_val[0], content: 'some content' }], draftAttachments, req, token);
      expect(req.data.content).toBeNull();
    });
  });

  describe("filterAttachments", () => {
    let service;
    let mockedReq;
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      mockedReq = {
        query: {
          SELECT: {},
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
          }
        }
      };
      getConfigurations.mockReturnValue({
        repositoryId: 'mockRepositoryId',
      });
    });

    it("should add a condition to filter attachments by repositoryId when where clause is empty", async() => {
      mockedReq.query.SELECT.where = [];
      await service.filterAttachments(mockedReq);
      expect(mockedReq.query.SELECT.where).toEqual([
        { ref: ['repositoryId'] },
        '=',
        { val: "mockRepositoryId" }
      ]); 
    });

    it("should add a condition to filter attachments by repositoryId when where clause already exists", async() => {
      mockedReq.query.SELECT.where = [{ ref: ['someField'] }, '=', { val: 'someValue' }];
      await service.filterAttachments(mockedReq);
      expect(mockedReq.query.SELECT.where).toEqual([
        { ref: ['someField'] },
        '=',
        { val: 'someValue' },
        'and',
        { ref: ['repositoryId'] },
        '=',
        { val: "mockRepositoryId" }
      ]); 
    });

    it("should add a condition to filter attachments by repositoryId when where clause doesn't exist", async() => {
      await service.filterAttachments(mockedReq);
      expect(mockedReq.query.SELECT.where).toEqual([
        { ref: ['repositoryId'] },
        '=',
        { val: "mockRepositoryId" }
      ]);
    });
  });

  describe("setRepository", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
  
      service = new SDMAttachmentsService();

      getConfigurations.mockReturnValue({
        repositoryId: 'mockRepositoryId',
      });
    });
  
    it("should call setRepositoryId with correct arguments", async () => {
      const mockReq = {
        query: {
          target: {
            name: 'Attachments',
          },
        },
      };
      let mockedAttachments = { entity: 'AttachmentsEntity' };
      cds.model.definitions = {
        Attachments: mockedAttachments,
      };
      await service.setRepository(mockReq);
  
      expect(setRepositoryId).toHaveBeenCalledWith(
        mockedAttachments,
        "mockRepositoryId"
      );
    });
  });
  

  describe("attachDeletionData", () => {
    let service;
    let repoInfo;
    beforeEach(() => {
      NodeCache.prototype.get.mockClear();
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      repoInfo = {
        data: {
          "123": {
            capabilities: {
              "capabilityContentStreamUpdatability": "pwconly"
            }
          }
        }
      }
      service = new SDMAttachmentsService();
      NodeCache.prototype.get.mockImplementation(() => undefined);
      getConfigurations.mockResolvedValueOnce({repositoryId: "123"});
      getRepositoryInfo.mockResolvedValueOnce(repoInfo);
      isRepositoryVersioned.mockResolvedValueOnce(false);
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
      const mockedReq = {
        query: {
          target: {
            name: 'Attachments',
          },
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

      let mockedAttachments = { entity: 'AttachmentsEntity' };
      cds.model.definitions = {
        "Attachments.attachments": mockedAttachments,
      };

      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdByPath.mockResolvedValueOnce("folder");
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.parentId).toEqual("folder");
      expect(getFolderIdByPath).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not set req.parentId if event is DELETE and getFolderIdForEntity() returns empty array", async () => {
      const mockedReq = {
        query: {
          target: {
            name: 'Attachments',
          },
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

      let mockedAttachments = { entity: 'AttachmentsEntity' };
      cds.model.definitions = {
        "Attachments.attachments": mockedAttachments,
      };

      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdByPath.mockResolvedValueOnce(null);
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.parentId).toBeUndefined();
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
        warn: jest.fn()
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
    })
  });

  describe("rename", () => {
    let service;
    let mockReq;
    let cds;
    beforeEach(() => {
      NodeCache.prototype.get.mockClear();
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
        warn: jest.fn()
      };

      cds.model.definitions[mockReq.query.target.name + ".attachments"] = {
        keys: {
          up_: {
            keys: [{ ref: ["attachment"] }],
          },
        },
      };
      const repoInfo = {
        data: {
          "123": {
            capabilities: {
              "capabilityContentStreamUpdatability": "pwconly"
            }
          }
        }
      }
      NodeCache.prototype.get.mockImplementation(() => undefined);
      getConfigurations.mockResolvedValueOnce({repositoryId: "123"});
      getRepositoryInfo.mockResolvedValueOnce(repoInfo);
      isRepositoryVersioned.mockResolvedValueOnce(false);
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

    it("should handle failure in onRename with duplicate error", async () => {
      const token = "token";
      const modifiedAttachments = [];

      service.onRename = jest.fn().mockResolvedValue([{typeOfError:'duplicate',name:"renameduplicate"}]);

      response = await service.rename(
        modifiedAttachments,
        token,
        mockReq
      );

      expect(response).toBe(renameFileErr(["renameduplicate"], 409));
    })

    it("should handle failure in onRename with not found error", async () => {
      const token = "token";
      const modifiedAttachments = [];
  
      service.onRename = jest.fn().mockResolvedValue([{typeOfError:'not found',name:"renameNotFound"}]);
  
      const response = await service.rename(
        modifiedAttachments,
        token,
        mockReq
      );
  
      expect(response).toBe(renameFileErr(["renameNotFound"], 404));
    });
  
    it("should handle failure in onRename with restricted characters error", async () => {
      const token = "token";
      const modifiedAttachments = [];
  
      service.onRename = jest.fn().mockResolvedValue([{typeOfError:'restricted characters',name:"renameRestricted"}]);
  
      const response = await service.rename(
        modifiedAttachments,
        token,
        mockReq
      );
  
      expect(response).toBe(nameConstrainErr(["renameRestricted"], "Rename"));
    });
  
    it("should handle failure in onRename with other errors", async () => {
      const token = "token";
      const modifiedAttachments = [];
  
      service.onRename = jest.fn().mockResolvedValue([{typeOfError:'some other error',name:"renameOtherError"}]);
  
      const response = await service.rename(
        modifiedAttachments,
        token,
        mockReq
      );
  
      expect(response).toBe(renameOtherFilesErr(["renameOtherError"],["some other error"]));
    });

    it("should handle multiple errors in onRename", async () => {
      const token = "token";
      const modifiedAttachments = [];
  
      service.onRename = jest.fn().mockResolvedValue([
        {typeOfError:'duplicate', name:"renameduplicate"},
        {typeOfError:'not found', name:"renameNotFound"},
        {typeOfError:'restricted characters', name:"renameRestricted"},
        {typeOfError:'some other error', name:"renameOtherError"}
      ]);
  
      const response = await service.rename(
        modifiedAttachments,
        token,
        mockReq
      );

      const expectedResponse = 
        nameConstrainErr(["renameRestricted"], "Rename") +
        renameFileErr(["renameduplicate"], 409) +
        renameFileErr(["renameNotFound"], 404) +
        renameOtherFilesErr(["renameOtherError"], ["some other error"])
      expect(response).toBe(expectedResponse);
    });
  });

  describe('onCreate', () => {
    let data, credentials, token, req, parentId, service;
  
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      data = [{ filename: 'file1' }];
      credentials = { user: 'user', pass: 'pass' };
      token = 'token';
      req = {
        reject: jest.fn(),
      };
      parentId = 'parent123';
    });
  
    it('should successfully create attachments and update draft', async () => {
      createAttachment
        .mockResolvedValueOnce({
          status: 201,
          data: { succinctProperties: { 'cmis:objectId': 'url1' } },
        });
      updateAttachmentInDraft.mockResolvedValue(true);
  
      await service.onCreate(data, credentials, token, req, parentId);
  
      expect(createAttachment).toHaveBeenCalledTimes(1);
      expect(updateAttachmentInDraft).toHaveBeenCalledTimes(1);
      expect(req.reject).not.toHaveBeenCalled();
    });
  
    it('should reject when a virus is found in the file', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 403,
        response: { data: { message: "Malware Service Exception: Virus found in the file!" } }
      });
  
      await service.onCreate(data, credentials, token, req, parentId);
  
      expect(req.reject).toHaveBeenCalledWith(403, virusFileErr(['file1']));
    });
  
    it('should reject when there is a name constraint violation', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 500,
        response: { data: { exception: "nameConstraintViolation" } }
      });
  
      await service.onCreate(data, credentials, token, req, parentId);
  
      expect(req.reject).toHaveBeenCalledWith(409, duplicateFileErr(['file1']));
    });
  
    it('should reject when another error occurs', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 500,
        response: { data: { exception: "some other error" } }
      });
  
      await service.onCreate(data, credentials, token, req, parentId);
  
      expect(req.reject).toHaveBeenCalledWith(otherFileErr(['file1']));
    });
  });

  describe("onRename", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      jest.resetAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { uri: 'sampleUri' };
    });
    it("should return empty array if no attachments fail", async () => {
      const modifiedAttachments = [{ name: "name", ID: "someID", url: "someURL" }];
      const credentials = {};
      const token = "token";
      const req = {
        data: {
          attachments: [
            {
              ID: 'someID',
              filename: 'someFilename'
            }
          ]
        }
      };
  
      isRestrictedCharactersInName.mockReturnValue(false);
      renameAttachment.mockResolvedValueOnce({
        status: 200,
        data: {
          message: 'success'
        }
      })
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'someFilename' });
  
      const result = await service.onRename(
        modifiedAttachments,
        credentials,
        token,
        req
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
      const modifiedAttachments = [{ name: "attachment#1", id:"id1" }, { name: "attachment#2", id:"id2", prevname: "attachment#2prev" }, { name: "attachment#3", id:"id3" }, { name: "attachment#4", id:"id4" }];
      const credentials = {};
      const token = "token";
      const req = {
        data: {
          attachments: [
            {
              id: "id1",
              name: "attachment#1"
            },
            {
              id: "id2",
              name: "attachment#2",
              prevname: "attachment#2prev"
            },
            {
              id: "id3",
              name: "attachment#3"
            },
            {
              id: "id4",
              name: "attachment#4"
            }
          ]
        }
      }
    
      isRestrictedCharactersInName.mockReturnValue(false);
      renameAttachment
        .mockResolvedValueOnce({
          status: 200,
          data: { succinctProperties: { "cmis:objectId": "url" } },
        })
        .mockResolvedValueOnce({
          status: 404,
          message: "File not found"
        })
        .mockResolvedValueOnce({
          status: 409,
          message: "File already exists"
        })
        .mockResolvedValueOnce({
          status: 403,
          message: "Unauthorized"
        })

      const result = await service.onRename(
        modifiedAttachments,
        credentials,
        token,
        req
      );
      expect(result).toEqual([{ "name": "attachment#2prev", "typeOfError": "not found" },{ "name": "attachment#3", "typeOfError": "duplicate" },{ "name": "attachment#4", "typeOfError": "Unauthorized" }]);
    });

    it("should handle restricted characters in filename and update filename in request", async () => {
      const modifiedAttachments = [{ name: "invalid/name", ID: "someID", url: "someURL" }];
      const credentials = {};
      const token = "token";
      const req = {
        data: {
          attachments: [
            {
              ID: 'someID',
              filename: 'someFilename'
            }
          ]
        }
      };
  
      isRestrictedCharactersInName.mockReturnValue(true);
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'updatedFilename' });
  
      const result = await service.onRename(
        modifiedAttachments,
        credentials,
        token,
        req
      );
  
      expect(result).toEqual([{ typeOfError: 'restricted characters', name: 'invalid/name' }]);
      expect(service.getAttachementDataInSDM).toHaveBeenCalledWith('sampleUri', token, 'someURL');
      expect(req.data.attachments[0].filename).toBe('updatedFilename');
    });
  });

  describe("getParentId", () => {
    let service;
    let mockReq;
    let cds;
    beforeEach(() => {
      NodeCache.prototype.get.mockClear();
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
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
      let attachments = cds.model.definitions[mockReq.query.target.name + ".attachments"]
      let token = "mocked_token"
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
      let attachments = cds.model.definitions[mockReq.query.target.name + ".attachments"]
      let token = "mocked_token"
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
  
    it("getParentId should reject with 403 if createFolder response status is 403 and message matches userDoesNotHaveRequiredScope", async () => {
      let attachments = cds.model.definitions[mockReq.query.target.name + ".attachments"];
      let token = "mocked_token";
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce(null);
      createFolder.mockResolvedValueOnce({
        status: 403,
        response: {
          data: userDoesNotHaveRequiredScope
        },
        data: {
          succinctProperties: {
            "cmis:objectId": "mock_object_id"
          }
        }
      });

      await service.getParentId(attachments, mockReq, token);

      expect(mockReq.reject).toHaveBeenCalledWith(403, userNotAuthorisedError);
    });

    it("getParentId should return parentId if folderId is not null in folderIds", async () => {
      let attachments = cds.model.definitions[mockReq.query.target.name + ".attachments"];
      let token = "mocked_token";

      const folderIds = [
        { folderId: null },
        { folderId: "mock_folder_id_1" },
        { folderId: "mock_folder_id_2" }
      ];
      
      getFolderIdForEntity.mockResolvedValueOnce(folderIds);

      const parentId = await service.getParentId(attachments, mockReq, token);

      expect(parentId).toEqual("mock_folder_id_1");
      expect(getFolderIdByPath).not.toHaveBeenCalled();
      expect(createFolder).not.toHaveBeenCalled();
    });
  });

  describe("isFileNameDuplicateInDrafts", () => {
    let service;
    let mockReq;

    beforeEach(() => {
      jest.clearAllMocks();
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
      let data = [
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

  describe('getStatus', () => {
    let service;
  
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });
  
    it('should return the status as "Clean"', async () => {
      const status = await service.getStatus();
      expect(status).toBe("Clean");
    });
  });

  describe("attachDraftDeletionData", () => {
    let service;
    let mockReq;
    let mockDraftAttachments;
    let cds;
  
    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
      jest.spyOn(service, 'checkRepositoryType').mockResolvedValue();
  
      mockReq = {
        query: {
          target: {
            name: "testName.drafts",
          },
        },
        event: "DELETE",
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
          },
        },
        diff: jest.fn(),
      };
  
      cds.model.definitions["testName.attachments.drafts"] = {};
    });
  
    it("should attach attachments to delete in req when they are present in drafts", async () => {
      mockDraftAttachments = cds.model.definitions["testName.attachments.drafts"];
  
      const attachmentsToDelete = ["attachment1", "attachment2"];
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce(attachmentsToDelete);
  
      mockReq.diff.mockResolvedValueOnce({
        attachments: ["attachment1", "attachment2"],
      });
  
      fetchAccessToken.mockResolvedValueOnce("mocked_token");
      getFolderIdByPath.mockResolvedValueOnce("mock_folder_id");
  
      await service.attachDraftDeletionData(mockReq);
  
      expect(service.checkRepositoryType).toHaveBeenCalledWith(mockReq);
      expect(getURLsToDeleteFromDraftAttachments).toHaveBeenCalledWith(mockDraftAttachments);
      expect(mockReq.attachmentsToDelete).toEqual(attachmentsToDelete);
      expect(mockReq.parentId).toEqual("mock_folder_id");
    });
  
    it("should not set `parentId` if the number of attachments in diff is different from `attachmentsToDelete`", async () => {
      const attachmentsToDelete = ["attachment1"];
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce(attachmentsToDelete);
  
      mockReq.diff.mockResolvedValueOnce({
        attachments: ["attachment1", "attachment2", "attachment3"],
      });
  
      await service.attachDraftDeletionData(mockReq);
      
      expect(mockReq.parentId).toBeUndefined();
    });
  
    it("should not attach attachments to delete if no draft attachments are found", async () => {
      delete cds.model.definitions["testName.attachments.drafts"];
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce([]);
  
      await service.attachDraftDeletionData(mockReq);
  
      expect(mockReq.attachmentsToDelete).toBeUndefined();
    });

    it("should not set attachmentsToDelete if attachmentsToDeleteFromDraft is empty", async () => {
  
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce([]); // Empty array to simulate no deletions
  
      mockReq.diff.mockResolvedValueOnce({
        attachments: ["attachment1", "attachment2"],
      });
  
      await service.attachDraftDeletionData(mockReq);
  
      // Verify that attachmentsToDelete is not set
      expect(mockReq.attachmentsToDelete).toBeUndefined();
      // Ensure that with no attachments to delete, parentId is not set
      expect(mockReq.parentId).toBeUndefined();
    });

    it("should not set parentId if folderId is not retrieved", async () => {
      const attachmentsToDelete = ["attachment1", "attachment2"];
      
      // Mock behavior to simulate presence of attachments to delete
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce(attachmentsToDelete);
      
      // Both arrays should be of the same length to trigger folderId fetch logic
      mockReq.diff.mockResolvedValueOnce({
        attachments: ["attachment1", "attachment2"],
      });
  
      // Simulate fetching a token, but folder ID fetch returns falsy
      fetchAccessToken.mockResolvedValueOnce("mocked_token");
      getFolderIdByPath.mockResolvedValueOnce(null); // Falsy value to test this situation
  
      await service.attachDraftDeletionData(mockReq);
  
      // Ensure parentId wasn't set since folderId is falsy
      expect(mockReq.parentId).toBeUndefined();
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
        ["entity", undefined],
        expect.any(Function)
      );
    });
    it("should call srv.before for PUT with correct target.drafts and callback", () => {
      const target = { drafts: "drafts" };
      service.registerUpdateHandlers(mockSrv, "entity", target);
      expect(mockSrv.before).toHaveBeenCalledWith(
        "PUT",
        target.drafts,
        expect.any(Function)
      );
    });

    it("should not call srv.before for PUT when target.drafts is not defined", () => {
      const target = {};
      service.registerUpdateHandlers(mockSrv, "entity", target);
      expect(mockSrv.before).not.toHaveBeenCalledWith(
        "PUT",
        undefined,
        expect.any(Function)
      );
    });
  });
});