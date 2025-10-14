const SDMAttachmentsService = require("../../lib/sdm");
const NodeCache = require("node-cache");
const {
  fetchAccessToken,
  getConfigurations,
  isRepositoryVersioned,
  getClientCredentialsToken,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties
} = require("../../lib/util");
const {
  getDraftAttachments,
  getDraftAttachmentsForUpID,
  getURLsToDeleteFromAttachments,
  getURLsToDeleteFromDraftAttachments,
  getURLToDeleteFromDraftAttachments,
  getURLFromAttachments,
  getFolderIdForEntity,
  updateAttachmentInDraft,
  setRepositoryId,
  getFileNameForAttachmentID,
  getPropertiesForID,
  getMetadataForOpenAttachment,
  getDraftAttachmentsMetadataForLinkCreation,
  updateLinkInDraft,
  getDraftAdministrativeData_DraftUUIDForUpId,
  getAttachmentById,
  editLinkInDraft
} = require("../../lib/persistence");
const {
  deleteAttachmentsOfFolder,
  createAttachment,
  readAttachment,
  getFolderIdByPath,
  getFolderIdByIDAsPath,
  createFolder,
  deleteFolderWithAttachments,
  getAttachment,
  getRepositoryInfo,
  updateAttachment,
  editLink
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
  sdmRolesErrorMessage
} = require("../../lib/util/messageConsts");

jest.mock("@cap-js/attachments/lib/basic", () => class {});
jest.mock("../../lib/persistence", () => ({
  getDraftAttachments: jest.fn(),
  getDraftAttachmentsForUpID: jest.fn(),
  getDuplicateAttachments: jest.fn(),
  getURLsToDeleteFromAttachments: jest.fn(),
  getURLsToDeleteFromDraftAttachments: jest.fn(),
  getURLToDeleteFromDraftAttachments: jest.fn(),
  getURLFromAttachments: jest.fn(),
  getFolderIdForEntity: jest.fn(),
  updateAttachmentInDraft: jest.fn(),
  getExistingAttachments: jest.fn(),
  setRepositoryId: jest.fn(),
  getFileNameForAttachmentID: jest.fn(),
  getPropertiesForID: jest.fn(),
  getMetadataForOpenAttachment: jest.fn(),
  getDraftAttachmentsMetadataForLinkCreation: jest.fn(),
  updateLinkInDraft: jest.fn(),
  getDraftAdministrativeData_DraftUUIDForUpId: jest.fn(),
  getAttachmentById: jest.fn(),
  editLinkInDraft: jest.fn()
}));
jest.mock("../../lib/util", () => ({
  fetchAccessToken: jest.fn(),
  checkAttachmentsToRename: jest.fn(),
  getConfigurations: jest.fn(),
  isRepositoryVersioned: jest.fn(),
  getClientCredentialsToken: jest.fn(),
  isRestrictedCharactersInName: jest.fn(),
  getStatusCondition: jest.fn(),
  getPropertyTitles: jest.fn(),
  getSecondaryPropertiesWithInvalidDefinition: jest.fn(),
  getSecondaryTypeProperties: jest.fn(),
  getUpdatedSecondaryProperties: jest.fn()
}));
jest.mock("../../lib/handler", () => ({
  deleteAttachmentsOfFolder: jest.fn(),
  createAttachment: jest.fn(),
  readAttachment: jest.fn(),
  getFolderIdByPath: jest.fn(),
  getFolderIdByIDAsPath: jest.fn(),
  createFolder: jest.fn(),
  deleteFolderWithAttachments: jest.fn(),
  getAttachment: jest.fn(),
  renameAttachment: jest.fn(),
  getRepositoryInfo: jest.fn(),
  updateAttachment: jest.fn(),
  editLink: jest.fn()
}));
jest.mock("@sap/cds/lib", () => {
  const mockCds = {
    model: {
      definitions: {},
    },
    utils: {
      uuid: jest.fn(() => "mock-uuid"),
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
      jest.resetAllMocks();
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
      isRepositoryVersioned.mockReturnValue(false);
  
      await service.checkRepositoryType(mockReq);
  
      expect(getClientCredentialsToken).toHaveBeenCalledWith(service.creds);
      expect(getRepositoryInfo).toHaveBeenCalledWith(mockReq, service.creds, "mock-token");
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
      expect(getRepositoryInfo).toHaveBeenCalledWith(mockReq, service.creds, "mock-token");
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
      jest.resetAllMocks();
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      service.creds = {
        uri: 'sampleUri'
      };
      req = {
        target: {
          name: 'sampleTarget'
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
  
    it('should not rename if no attachments are modified', async () => {
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn();
      service.updateNonDraftAttachments = jest.fn();
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue([]);
  
      await service.renameHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(fetchAccessToken).not.toHaveBeenCalled();
      expect(getDraftAttachments).toHaveBeenCalledWith(cds.model.definitions['sampleTarget.attachments'], req, 'repo123');
      expect(service.updateDraftAttachments).not.toHaveBeenCalled();
      expect(service.updateNonDraftAttachments).not.toHaveBeenCalled();
      expect(req.warn).not.toHaveBeenCalled();
    });

    it('should rename draft and non-draft attachments', async () => {
      const draftAttachments = [
        { HasActiveEntity: false, ID: 'draft1' },
        { HasActiveEntity: false, ID: 'draft2' }
      ];
      const nonDraftAttachments = [
        { HasActiveEntity: true, ID: 'nonDraft1' },
        { HasActiveEntity: true, ID: 'nonDraft2' }
      ];
      const allAttachments = [...draftAttachments, ...nonDraftAttachments];
  
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn().mockResolvedValue([]);
      service.updateNonDraftAttachments = jest.fn().mockResolvedValue([]);
      service.clearSecondaryPropertiesCache = jest.fn();
      service.handleWarning = jest.fn().mockReturnValue([]);
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue(allAttachments);
      getPropertyTitles.mockReturnValue(["Title1", "Title2"]);
      getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({ invalidProperty: "value" });
      getSecondaryTypeProperties.mockReturnValue(new Map([["property1", "value1"], ["property2", "value2"]]));
  
      await service.renameHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(allAttachments, req);
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'sampleTokenValue');
      expect(service.updateDraftAttachments).toHaveBeenCalledTimes(2);
      expect(service.updateNonDraftAttachments).toHaveBeenCalledTimes(2);
      expect(service.clearSecondaryPropertiesCache).toHaveBeenCalledWith('repo123');
      expect(req.warn).not.toHaveBeenCalled();
    });

    it('should log warnings if there are errors during renaming', async () => {
      const draftAttachments = [
        { HasActiveEntity: false, ID: 'draft1' }
      ];
      const nonDraftAttachments = [
        { HasActiveEntity: true, ID: 'nonDraft1' }
      ];
      const allAttachments = [...draftAttachments, ...nonDraftAttachments];
      const mockErrors = ['Error1', 'Error2'];
  
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn().mockResolvedValue(['Error1']);
      service.updateNonDraftAttachments = jest.fn().mockResolvedValue(['Error2']);
      service.clearSecondaryPropertiesCache = jest.fn();
      service.handleWarning = jest.fn().mockReturnValue(mockErrors);
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue(allAttachments);
  
      await service.renameHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(allAttachments, req);
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'sampleTokenValue');
      expect(service.updateDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.updateNonDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.clearSecondaryPropertiesCache).toHaveBeenCalledWith('repo123');
      expect(req.warn).toHaveBeenCalledWith(500, mockErrors);
    });

    it('should handle errors during fetchAccessToken', async () => {
      fetchAccessToken.mockRejectedValue(new Error('Token fetch failed'));
      getDraftAttachments.mockResolvedValue([{ HasActiveEntity: false, ID: 'draft1' }]);
      service.isFileNameDuplicateInDrafts = jest.fn();
      service.updateDraftAttachments = jest.fn();
      service.updateNonDraftAttachments = jest.fn();
  
      await expect(service.renameHandler(req)).rejects.toThrow('Token fetch failed');
  
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'sampleTokenValue');
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(service.updateDraftAttachments).not.toHaveBeenCalled();
      expect(service.updateNonDraftAttachments).not.toHaveBeenCalled();
    });

    it('should handle errors during updateDraftAttachments', async () => {
      const draftAttachments = [
        { HasActiveEntity: false, ID: 'draft1' }
      ];
      const nonDraftAttachments = [
        { HasActiveEntity: true, ID: 'nonDraft1' }
      ];
      const allAttachments = [...draftAttachments, ...nonDraftAttachments];
  
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn().mockRejectedValue(new Error('Draft update failed'));
      service.updateNonDraftAttachments = jest.fn().mockResolvedValue([]);
      service.clearSecondaryPropertiesCache = jest.fn();
  
      fetchAccessToken.mockResolvedValue(token);
      getDraftAttachments.mockResolvedValue(allAttachments);
  
      await expect(service.renameHandler(req)).rejects.toThrow('Draft update failed');
  
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(allAttachments, req);
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'sampleTokenValue');
      expect(service.updateDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.updateNonDraftAttachments).not.toHaveBeenCalled();
    });
  });

  describe('updateNonDraftAttachments', () => {
    let service;
    let req;
    let token;
    let attachment;
    let attachmentsEntity;
    let secondaryPropertiesWithInvalidDefinitions;
    let secondaryTypeProperties;
  
    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      req = {
        reject: jest.fn(),
        data: {
          attachments: [{ ID: 'attachment1', filename: 'file1.txt' }]
        }
      };
      token = 'mockToken';
      attachment = { ID: 'attachment1', filename: 'file1.txt' };
      attachmentsEntity = {};
      secondaryPropertiesWithInvalidDefinitions = {};
      secondaryTypeProperties = new Map();
  
      // Mock dependencies
      service.replacePropertiesInAttachment = jest.fn();
      getFileNameForAttachmentID.mockResolvedValue('file1.txt');
      getPropertiesForID.mockResolvedValue({ property1: 'value1' });
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' });
      updateAttachment.mockResolvedValue(200);
      isRestrictedCharactersInName.mockReturnValue(false);
    });
  
    it('should return an error if filename contains restricted characters', async () => {
      isRestrictedCharactersInName.mockReturnValue(true);
  
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'restricted characters', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should return empty name error if filename is null', async () => {
      attachment.filename = null;
    
      const response = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
    
      // Verify that req.reject was called with the correct arguments
      expect(response[0]).toEqual(
        {typeOfError: 'empty name', name: null}
      );
    });
  
    it('should update the filename if it differs from the database', async () => {
      getFileNameForAttachmentID.mockResolvedValue('file2.txt');
  
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(getUpdatedSecondaryProperties).toHaveBeenCalledWith(
        attachment,
        secondaryTypeProperties,
        { property1: 'value1' }
      );
      expect(updateAttachment).toHaveBeenCalledWith(
        req,
        attachment,
        service.creds,
        token,
        { property1: 'updatedValue1', 'cmis:name': 'file1.txt' },
        secondaryPropertiesWithInvalidDefinitions
      );
      expect(result).toEqual([]);
    });

    it('should update cmis:name if filenameInRequest is not null', async () => {
      getFileNameForAttachmentID.mockResolvedValue(null);
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(getUpdatedSecondaryProperties).toHaveBeenCalledWith(
        attachment,
        secondaryTypeProperties,
        { property1: 'value1' }
      );
      expect(updateAttachment).toHaveBeenCalledWith(
        req,
        attachment,
        service.creds,
        token,
        { property1: 'updatedValue1', 'cmis:name': 'file1.txt' },
        secondaryPropertiesWithInvalidDefinitions
      );
      expect(result).toEqual([]);
    });
  
    it('should handle a 403 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(403);
  
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'no sdm roles', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should handle a 409 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(409);
  
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'duplicate', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should handle a 404 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(404);
  
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'not found', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });

    it('should handle an unexpected response code in the default case', async () => {
      // Mock dependencies
      getFileNameForAttachmentID.mockResolvedValue('file1.txt'); // Simulate fileNameInDB
      getPropertiesForID.mockResolvedValue({ property1: 'value1' }); // Simulate properties from DB
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' }); // Simulate updated properties
      updateAttachment.mockResolvedValue(500); // Simulate an unexpected response code
    
      // Call the method
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
    
      // Verify the result contains the error for the unexpected response code
      expect(result).toEqual([
        {
          typeOfError: 'bad request',
          name: 'file1.txt',
          message: sdmRolesErrorMessage, // Matches the error message from the default case
        },
      ]);
    
      // Ensure replacePropertiesInAttachment is called
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    
      // Ensure updateAttachment was called with the correct arguments
      expect(updateAttachment).toHaveBeenCalledWith(
        req,
        attachment,
        service.creds,
        token,
        { property1: 'updatedValue1' },
        secondaryPropertiesWithInvalidDefinitions
      );
    });
  
    it('should handle unsupported properties error', async () => {
      updateAttachment.mockRejectedValue(new Error('Unsupported properties: property1, property2'));
  
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([
        {
          typeOfError: 'unsupported properties',
          details: ': property1, property2'
        }
      ]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should handle other errors during updateAttachment', async () => {
      updateAttachment.mockRejectedValue(new Error('Some other error'));
  
      const result = await service.updateNonDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([
        {
          typeOfError: 'bad request',
          name: 'file1.txt',
          message: 'Some other error'
        }
      ]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  });

  describe('updateDraftAttachments', () => {
    let service;
    let req;
    let token;
    let attachment;
    let attachmentsEntity;
    let secondaryPropertiesWithInvalidDefinitions;
    let secondaryTypeProperties;
  
    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      req = {
        reject: jest.fn(),
        data: {
          attachments: [{ ID: 'attachment1', filename: 'file1.txt' }]
        }
      };
      token = 'mockToken';
      attachment = { ID: 'attachment1', filename: 'file1.txt', url: 'mockUrl' };
      attachmentsEntity = {};
      secondaryPropertiesWithInvalidDefinitions = {};
      secondaryTypeProperties = new Map();

      // Initialize creds with a valid uri
      service.creds = { uri: 'mockUri' };
  
      // Mock dependencies
      service.replacePropertiesInAttachment = jest.fn();
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'file1.txt', folderId: 'mockFolderId' });
      getPropertiesForID.mockResolvedValue({ property1: 'value1' });
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' });
      updateAttachment.mockResolvedValue(200);
      isRestrictedCharactersInName.mockReturnValue(false);
    });
  
    it('should return an error if filename contains restricted characters', async () => {
      isRestrictedCharactersInName.mockReturnValue(true);
  
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'restricted characters', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should reject if filenameInRequest is null', async () => {
      attachment.filename = null;
  
      const response = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(response[0]).toEqual(
        {typeOfError: 'empty name', name: null}
      );
    });
  
    it('should update cmis:name if filenameInRequest differs from filenameInSDM', async () => {
      service.getAttachementDataInSDM.mockResolvedValue({ filename: 'file2.txt', folderId: 'mockFolderId' });
  
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(getUpdatedSecondaryProperties).toHaveBeenCalledWith(
        attachment,
        secondaryTypeProperties,
        { property1: 'value1' }
      );
      expect(updateAttachment).toHaveBeenCalledWith(
        req,
        attachment,
        service.creds,
        token,
        { property1: 'updatedValue1', 'cmis:name': 'file1.txt' },
        secondaryPropertiesWithInvalidDefinitions
      );
      expect(result).toEqual([]);
    });
  
    it('should handle a 403 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(403);
  
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'no sdm roles', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should handle a 409 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(409);
  
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'duplicate', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should handle a 404 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(404);
  
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([{ typeOfError: 'not found', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });

    it('should handle an unexpected response code in the default case', async () => {
      // Mock dependencies
      service.getAttachementDataInSDM.mockResolvedValue({ filename: 'file1.txt', folderId: 'mockFolderId' });
      getPropertiesForID.mockResolvedValue({ property1: 'value1' });
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' });
      updateAttachment.mockResolvedValue(500); // Simulate an unexpected response code
    
      // Call the method
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
    
      // Verify the result contains the error for the unexpected response code
      expect(result).toEqual([
        {
          typeOfError: 'bad request',
          name: 'file1.txt',
          message: sdmRolesErrorMessage, // Matches the error message from the default case
        },
      ]);
    
      // Ensure replacePropertiesInAttachment is called
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    
      // Ensure updateAttachment was called with the correct arguments
      expect(updateAttachment).toHaveBeenCalledWith(
        req,
        attachment,
        service.creds,
        token,
        { property1: 'updatedValue1' },
        secondaryPropertiesWithInvalidDefinitions
      );
    });
  
    it('should handle unsupported properties error', async () => {
      updateAttachment.mockRejectedValue(new Error('Unsupported properties: property1, property2'));
  
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([
        {
          typeOfError: 'unsupported properties',
          details: ': property1, property2'
        }
      ]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  
    it('should handle other errors during updateAttachment', async () => {
      updateAttachment.mockRejectedValue(new Error('Some other error'));
  
      const result = await service.updateDraftAttachments(
        req,
        token,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties
      );
  
      expect(result).toEqual([
        {
          typeOfError: 'bad request',
          name: 'file1.txt',
          message: 'Some other error'
        }
      ]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties
      );
    });
  });

  describe('replacePropertiesInAttachment', () => {
    let service;
    let req;
    let secondaryTypeProperties;
  
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      req = {
        data: {
          attachments: [
            { ID: 'attachment1', filename: 'oldFileName', property1: 'oldValue1', property2: 'oldValue2' },
            { ID: 'attachment2', filename: 'anotherOldFileName', property3: 'oldValue3' }
          ]
        }
      };
      secondaryTypeProperties = new Map([
        ['secondaryKey1', 'property1'],
        ['secondaryKey2', 'property2']
      ]);
    });
  
    it('should replace properties and filename in the attachment', () => {
      const propertiesInDB = { property1: 'newValue1', property2: 'newValue2' };
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties);
  
      const updatedAttachment = req.data.attachments.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.secondaryKey1).toBe('newValue1');
      expect(updatedAttachment.secondaryKey2).toBe('newValue2');
    });
  
    it('should not modify properties if propertiesInDB is null', () => {
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, null, secondaryTypeProperties);
  
      const updatedAttachment = req.data.attachments.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.property1).toBe('oldValue1'); // Ensure properties are not modified
      expect(updatedAttachment.property2).toBe('oldValue2');
    });
  
    it('should not modify attachments if ID is not found', () => {
      const propertiesInDB = { property1: 'newValue1', property2: 'newValue2' };
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'nonExistentID', fileName, propertiesInDB, secondaryTypeProperties);
  
      const updatedAttachment = req.data.attachments.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('oldFileName'); // Ensure filename is not modified
      expect(updatedAttachment.property1).toBe('oldValue1'); // Ensure properties are not modified
      expect(updatedAttachment.property2).toBe('oldValue2');
    });
  
    it('should handle secondaryTypeProperties with no matching keys', () => {
      const propertiesInDB = { property3: 'newValue3' }; // No matching keys in secondaryTypeProperties
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties);
  
      const updatedAttachment = req.data.attachments.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.property1).toBe('oldValue1'); // Ensure properties are not modified
      expect(updatedAttachment.property2).toBe('oldValue2');
    });
  
    it('should replace only matching properties in the attachment', () => {
      const propertiesInDB = { property1: 'newValue1' }; // Only one matching property
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties);
  
      const updatedAttachment = req.data.attachments.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.secondaryKey1).toBe('newValue1'); // Ensure matching property is updated
      expect(updatedAttachment.secondaryKey2).toBeUndefined(); // Ensure non-matching property is not updated
    });
  });

  // describe('clearSecondaryPropertiesCache', () => {
  //   let service;
  //   let cache;
  //   const repositoryId = 'mockRepositoryId';
  //   const cacheKey = `validSecondaryProperties_${repositoryId}`;
  
  //   beforeEach(() => {
  //     jest.clearAllMocks();
  
  //     // Mock the global cache object
  //     cache = {
  //       has: jest.fn(),
  //       del: jest.fn(),
  //     };
  //     global.cache = cache; // Assign the mocked cache to the global object
  
  //     service = new SDMAttachmentsService();
  //   });
  
  //   afterEach(() => {
  //     delete global.cache; // Clean up the global cache mock
  //   });
  
  //   it('should remove the cache key if it exists', () => {
  //     // Mock the cache to have the key
  //     cache.has.mockReturnValue(true);
  
  //     // Call the method
  //     service.clearSecondaryPropertiesCache(repositoryId);
  
  //     // Verify the cache key is removed
  //     expect(cache.has).toHaveBeenCalledWith(cacheKey);
  //     expect(cache.del).toHaveBeenCalledWith(cacheKey);
  //   });
  
  //   it('should do nothing if the cache key does not exist', () => {
  //     // Mock the cache to not have the key
  //     cache.has.mockReturnValue(false);
  
  //     // Call the method
  //     service.clearSecondaryPropertiesCache(repositoryId);
  
  //     // Verify the cache key is not removed
  //     expect(cache.has).toHaveBeenCalledWith(cacheKey);
  //     expect(cache.del).not.toHaveBeenCalled();
  //   });
  // });

  describe('handleWarning', () => {
    let service;
    let propertyTitles;
  
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      propertyTitles = {
        property1: 'Invalid Property 1',
        property2: 'Invalid Property 2',
      };
    });
  
    it('should handle restricted characters errors', () => {
      const allErrors = [
        { typeOfError: 'restricted characters', name: 'file1.txt' },
        { typeOfError: 'restricted characters', name: 'file2.txt' },
      ];
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
      expect(result).toContain('Update');
    });
  
    it('should handle duplicate errors', () => {
      const allErrors = [
        { typeOfError: 'duplicate', name: 'file1.txt' },
        { typeOfError: 'duplicate', name: 'file2.txt' },
      ];
      getStatusCondition.mockReturnValue('already');
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
      expect(result).toContain('already');
    });
  
    it('should handle not found errors', () => {
      const allErrors = [
        { typeOfError: 'not found', name: 'file1.txt' },
        { typeOfError: 'not found', name: 'file2.txt' },
      ];
      getStatusCondition.mockReturnValue("don't");
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
      expect(result).toContain("don't");
    });
  
    it('should handle no SDM roles errors', () => {
      const allErrors = [
        { typeOfError: 'no sdm roles', name: 'file1.txt' },
        { typeOfError: 'no sdm roles', name: 'file2.txt' },
      ];
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
      expect(result).toContain('update');
    });
  
    it('should handle unsupported properties errors', () => {
      const allErrors = [
        { typeOfError: 'unsupported properties', details: 'property1, property2' },
      ];
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toContain('Invalid Property 1');
      expect(result).toContain('Invalid Property 2');
    });
  
    it('should handle bad request errors', () => {
      const allErrors = [
        { typeOfError: 'bad request', name: 'file1.txt', message: 'Some error' },
      ];
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toContain('file1.txt');
      expect(result).toContain('Some error');
    });
  
    it('should handle other errors', () => {
      const allErrors = [
        { typeOfError: 'other error', name: 'file1.txt' },
        { typeOfError: 'other error', name: 'file2.txt' },
      ];
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toContain('file1.txt');
      expect(result).toContain('file2.txt');
    });
  
    it('should return an empty string if there are no errors', () => {
      const allErrors = [];
  
      const result = service.handleWarning(allErrors, propertyTitles);
  
      expect(result).toBe('');
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
      jest.resetAllMocks();
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
      const req = {
      req:  {
              url: '/Incidents_attachments(up__ID=c66fcc09-90c5-4026-acde-19ef5297cd7f,ID=afc3d040-60ae-4bf2-a44f-1da4043f4257,IsActiveEntity=false)/content' // Example URL containing an ID; ensure the format matches your actual usage
            },
        data: {
          content: 'some content' 
        }, 
        params: [
          {
            ID: '12345'
          },
          {
            ID: '12345'
          }
        ],
        target: draftAttachments,
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('mockTokenValue') 
          } 
        } 
      };
      const token = 'token123';
      const attachment_val = [
        { HasActiveEntity: false, ID: 'afc3d040-60ae-4bf2-a44f-1da4043f4257', filename: 'sample.txt' },
        { HasActiveEntity: true, ID: '67890', filename: 'other.txt' },
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
      const req = {
      req: {
                      url: '/Incidents_attachments(up__ID=c66fcc09-90c5-4026-acde-19ef5297cd7f,ID=afc3d040-60ae-4bf2-a44f-1da4043f4257,IsActiveEntity=false)/content' // Example URL containing an ID; ensure the format matches your actual usage
                    },

              data: {
                content: 'some content'
              },
              params: [
                {
                  ID: '12345'
                },
                {
                            ID: '12345'
                          }
              ],
              target: draftAttachments,
              user: {
                tokenInfo: {
                  getTokenValue: jest.fn().mockReturnValue('mockTokenValue')
                }
              }
            };
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
      const req = {
       req: {
              url: '/Incidents_attachments(up__ID=c66fcc09-90c5-4026-acde-19ef5297cd7f,ID=afc3d040-60ae-4bf2-a44f-1da4043f4257,IsActiveEntity=false)/content' // Example URL containing an ID; ensure the format matches your actual usage
            },

        data: {
          content: 'some content' 
        },
        params:[
          {
            ID: '12345'
          },
          {
            ID: '12345'
          }
        ], 
        target: draftAttachments, 
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('mockTokenValue')
          } }, reject: jest.fn() };
          const token = 'token123';
      const attachment_val = [
        { HasActiveEntity: false, ID: 'afc3d040-60ae-4bf2-a44f-1da4043f4257', filename: 'invalid/name' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      fetchAccessToken.mockResolvedValue(token);
      isRestrictedCharactersInName.mockReturnValue(true);
  
      await service.draftSaveHandler(req);
  
      expect(req.reject).toHaveBeenCalledWith(409, nameConstrainErr(['invalid/name'], "Upload"));
    });
     test('when req.data.content null', async () => {
          const draftAttachments = [];
          const req = {

           req: {
                    url: '/Incidents_attachments(up__ID=c66fcc09-90c5-4026-acde-19ef5297cd7f,ID=afc3d040-60ae-4bf2-a44f-1da4043f4257,IsActiveEntity=false)/content' // Example URL containing an ID; ensure the format matches your actual usage
                  },
            data: {
              content: 'some content'
            },
            params:[
              {
                ID: '12345'
              },
              {
                ID: '12345'
              }
            ],
            target: draftAttachments,
            user: {
              tokenInfo: {
                getTokenValue: jest.fn().mockReturnValue('mockTokenValue')
              } }, reject: jest.fn() };
              const token = 'token123';
          const attachment_val = [
            { HasActiveEntity: false, ID: '4555', filename: null },
            { HasActiveEntity: true, ID: '67890' },
          ];
          getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
          fetchAccessToken.mockResolvedValue(token);
          isRestrictedCharactersInName.mockReturnValue(true);

          await service.draftSaveHandler(req);

          expect(service.create).not.toHaveBeenCalled();
        });
  
    test('should not reject when filename does not contain restricted characters', async () => {
      const draftAttachments = [];
      const req = {
      req: {
          url: '/Incidents_attachments(up__ID=c66fcc09-90c5-4026-acde-19ef5297cd7f,ID=afc3d040-60ae-4bf2-a44f-1da4043f4257,IsActiveEntity=false)/content' // Example URL containing an ID; ensure the format matches your actual usage
        },
        data: {
        content: 'some content' },
        params: [
          {
            ID: '12345'
          },
          {
            ID: '12345'
          }
        ],
        target: draftAttachments,
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('mockTokenValue') 
          }
        },
        reject: jest.fn() 
      };
      const token = 'token123';
      const attachment_val = [
        { HasActiveEntity: false, ID: 'afc3d040-60ae-4bf2-a44f-1da4043f4257', filename: 'validname' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);

      fetchAccessToken.mockResolvedValue(token);
      isRestrictedCharactersInName.mockReturnValue(false);

      await service.draftSaveHandler(req);

      expect(req.reject).not.toHaveBeenCalled();
      expect(service.create).toHaveBeenCalledWith([{ HasActiveEntity: false, ID: "afc3d040-60ae-4bf2-a44f-1da4043f4257", content: 'some content', filename: 'validname' }], draftAttachments, req, token);  
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
        target: {
          name: 'Attachments',
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
        target: {
          name: "myName",
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
        target: {
          name: "myName",
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
        target: {
          name: "myName",
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
        target: {
          name: 'Attachments',
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
      getFolderIdByIDAsPath.mockResolvedValueOnce("folder");
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.parentId).toEqual("folder");
      expect(getFolderIdByIDAsPath).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not set req.parentId if event is DELETE and getFolderIdForEntity() returns empty array", async () => {
      const mockedReq = {
        target: {
          name: 'Attachments',
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
      getFolderIdByIDAsPath.mockResolvedValueOnce(null);
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.parentId).toBeUndefined();
      expect(getFolderIdByIDAsPath).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not call getFolderIdForEntity() if event is not DELETE", async () => {
      const mockReq = {
        target: { name: "testName" },
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
        target: { name: "testName" },
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
      delete cds.model.definitions[mockReq.target.name + ".attachments"];
      await service.attachDeletionData(mockReq);

      // Assuming that these are called inside if(attachments) block
      expect(mockReq.diff).not.toHaveBeenCalled();
      expect(getURLsToDeleteFromAttachments).not.toHaveBeenCalled();
    });

    it("attachDeletionData() should not set req.attachmentsToDelete if there are no attachments to delete", async () => {
      const mockReq = {
        target: { name: "testName" },
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

  describe('attachURLsToDeleteFromAttachmentsDraft', () => {
  
    let service;
    
    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();
      
      // Mock implementation for getURLToDeleteFromDraftAttachments
      getURLToDeleteFromDraftAttachments.mockResolvedValue([{ url: 'http://example.com/attachment1', ID: '1' }]);
  
      // Mock implementation for deleteAttachmentsOfFolder
      deleteAttachmentsOfFolder.mockImplementation(async () => {
        return { status: 200 };
      });
    });

    afterEach(() => {
      jest.clearAllMocks();
    });
    
    it('should attach URLs to delete and call deleteAttachmentsWithKeys with correct data', async () => {
      const req = {
              target: {   name: 'DraftAttachments'  },
              data:  { ID: 'some-other-id'},
              user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue("tokenValue") } },
            };
            cds.model.definitions["DraftAttachments"] = {};

            // Define a mock function on the service instance to observe it being called
            const deleteAttachmentsSpy = jest.spyOn(service, 'deleteAttachmentsWithKeys');

            // Call the method
            await service.attachURLsToDeleteFromAttachmentsDraft(req);

            expect(req.attachmentsToDelete).toEqual([{ url: 'http://example.com/attachment1', ID: '1' }]);

            // Validate deleteAttachmentsWithKeys has been called
            expect(deleteAttachmentsSpy).toHaveBeenCalled();

            // Validate deleteAttachmentsWithKeys is called with the correct arguments
            expect(deleteAttachmentsSpy).toHaveBeenCalledWith(req.attachmentsToDelete, req);
          });
    
    it('should not call deleteAttachmentsWithKeys if there are no attachments to delete', async () => {
      getURLToDeleteFromDraftAttachments.mockImplementationOnce(async () => {
        return [];
      });
  
      const req = {
        target: { name: 'DraftAttachments' },
        data: { ID: 'some-other-id' },
        user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue("tokenValue") } },
      };
      cds.model.definitions["DraftAttachments"] = {};
      
      await service.attachURLsToDeleteFromAttachmentsDraft(req);
  
      expect(req.attachmentsToDelete).toBeUndefined();
    });
  });

  describe("deleteAttachmentsWithKeys", () => {
    let service;
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });
    afterEach(() => {
      jest.clearAllMocks();
    });
    it("should delete attachments if req.attachmentsToDelete has records to delete", async () => {
      const records = [];
      const req = {
        target: { name: "testTarget" },
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

      cds.model.definitions["testTarget.attachments"] = {};
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
        target: { name: "testTarget" },
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
        target: { name: "testName" },
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
        target: { name: "testTarget" },
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
        target: {
          name: "testName",
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

      cds.model.definitions[mockReq.target.name + ".attachments"] = {
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

  describe("openAttachment", () => {
    let service;
    let req;
    let cds;

    beforeEach(() => {
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();

      req = {
        target: { name: "MyEntity" },
        req: { url: "/MyEntity(ID=123e4567-e89b-12d3-a456-426614174000)" }
      };
      cds.model.definitions = {
        MyEntity: { entity: "MyEntity" },
        "MyEntity.drafts": { entity: "MyEntityDrafts" }
      };
    });

    it("should return linkUrl if mimeType is application/internet-shortcut", async () => {
      getMetadataForOpenAttachment.mockResolvedValueOnce({
        filename: "file.url",
        mimeType: "application/internet-shortcut",
        linkUrl: "http://example.com"
      });

      const result = await service.openAttachment(req);

      expect(getMetadataForOpenAttachment).toHaveBeenCalledWith(
        { ID: "123e4567-e89b-12d3-a456-426614174000" },
        cds.model.definitions.MyEntity
      );
      expect(result).toEqual({ value: "http://example.com" });
    });

    it("should retry with non-draft entity if filename is null", async () => {
      getMetadataForOpenAttachment
        .mockResolvedValueOnce({ filename: null })
        .mockResolvedValueOnce({
          filename: "file.url",
          mimeType: "application/internet-shortcut",
          linkUrl: "http://example.com"
        });

      req.target.name = "MyEntity.drafts";
      cds.model.definitions["MyEntity"] = { entity: "MyEntity" };

      const result = await service.openAttachment(req);

      expect(getMetadataForOpenAttachment).toHaveBeenNthCalledWith(
        1,
        { ID: "123e4567-e89b-12d3-a456-426614174000" },
        cds.model.definitions["MyEntity.drafts"]
      );
      expect(getMetadataForOpenAttachment).toHaveBeenNthCalledWith(
        2,
        { ID: "123e4567-e89b-12d3-a456-426614174000" },
        cds.model.definitions["MyEntity"]
      );
      expect(result).toEqual({ value: "http://example.com" });
    });

    it('should return { value: "None" } if mimeType is not application/internet-shortcut', async () => {
      getMetadataForOpenAttachment.mockResolvedValueOnce({
        filename: "file.pdf",
        mimeType: "application/pdf",
        linkUrl: "http://example.com"
      });

      const result = await service.openAttachment(req);

      expect(result).toEqual({ value: "None" });
    });

    it('should return { value: "None" } if response is undefined', async () => {
      getMetadataForOpenAttachment.mockResolvedValueOnce(undefined);

      const result = await service.openAttachment(req);

      expect(result).toEqual({ value: "None" });
    });

    it('should handle missing match in URL gracefully', async () => {
      req.req.url = "/MyEntity(ID=invalid)";
      await expect(service.openAttachment(req)).rejects.toThrow();
    });
  });

  describe("handleCreateLinkAction", () => {
    let service;
    let req;
    let cds;

    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
      cds = require("@sap/cds/lib");
      service = new SDMAttachmentsService();

      service.checkRepositoryType = jest.fn().mockResolvedValue();
      service.validateLinkName = jest.fn().mockResolvedValue();
      service.processLinkCreation = jest.fn().mockResolvedValue();

      req = {
        req: { url: "/MyEntity(ID=123e4567-e89b-12d3-a456-426614174000)" },
        target: { name: "MyEntity" },
        data: { name: "linkName", url: "http://example.com" },
        user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue("tokenValue") } }
      };
      cds.model.definitions = { MyEntity: { entity: "MyEntity" } };
      getConfigurations.mockReturnValue({  repositoryId: "repo123" });
      getDraftAttachmentsMetadataForLinkCreation.mockResolvedValue([{ filename: "existingLink" }]);
      fetchAccessToken.mockResolvedValueOnce("mockToken");
    });

    it("should process link creation successfully", async () => {
      await service.handleCreateLinkAction(req);

      expect(service.checkRepositoryType).toHaveBeenCalledWith(req);
      expect(getDraftAttachmentsMetadataForLinkCreation).toHaveBeenCalledWith(
        "123e4567-e89b-12d3-a456-426614174000",
        cds.model.definitions.MyEntity,
        "repo123"
      );
      expect(service.validateLinkName).toHaveBeenCalledWith(
        [{ filename: "existingLink" }],
        "linkName",
        req
      );
      expect(fetchAccessToken).toHaveBeenCalledWith(
        service.creds,
        "tokenValue"
      );
      expect(service.processLinkCreation).toHaveBeenCalledWith(
        {
          filename: "linkName",
          mimeType: "application/internet-shortcut",
          repositoryId: "repo123",
          linkUrl: "http://example.com"
        },
        cds.model.definitions.MyEntity,
        req,
        "mockToken"
      );
    });

    it("should throw if checkRepositoryType fails", async () => {
      service.checkRepositoryType.mockRejectedValue(new Error("repo error"));
      await expect(service.handleCreateLinkAction(req)).rejects.toThrow("repo error");
    });

    it("should throw if validateLinkName fails", async () => {
      service.validateLinkName.mockRejectedValue(new Error("duplicate"));
      await expect(service.handleCreateLinkAction(req)).rejects.toThrow("duplicate");
    });

    it("should throw if processLinkCreation fails", async () => {
      service.processLinkCreation.mockRejectedValue(new Error("process error"));
      await expect(service.handleCreateLinkAction(req)).rejects.toThrow("process error");
    });
  });

  describe("processLinkCreation", () => {
    let service;
    let req;
    let attachment;
    let linkToCreateInSDM;
    let token;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.getParentId = jest.fn().mockResolvedValue("parentId");
      service.createLink = jest.fn().mockResolvedValue();
      req = {
        req: { url: "/MyEntity(ID=123e4567-e89b-12d3-a456-426614174000)" }
      };
      attachment = {
        keys: {
          up_: {
            keys: [{ $generatedFieldName: "upIdField" }]
          }
        }
      };
      linkToCreateInSDM = {
        filename: "linkName",
        mimeType: "application/internet-shortcut",
        repositoryId: "repo123",
        linkUrl: "http://example.com"
      };
      token = "mockToken";
      global.attachmentIDRegex = /ID=([0-9a-fA-F-]{36})/;
    });

    it("should call getParentId and createLink with correct arguments", async () => {
      await service.processLinkCreation(linkToCreateInSDM, attachment, req, token);

      expect(service.getParentId).toHaveBeenCalledWith(
        attachment,
        req,
        token,
        "123e4567-e89b-12d3-a456-426614174000"
      );
      expect(service.createLink).toHaveBeenCalledWith(
        linkToCreateInSDM,
        service.creds,
        token,
        req,
        "parentId",
        "upIdField"
      );
    });

    it("should throw if getParentId fails", async () => {
      service.getParentId.mockRejectedValue(new Error("parent error"));
      await expect(
        service.processLinkCreation(linkToCreateInSDM, attachment, req, token)
      ).rejects.toThrow("parent error");
    });

    it("should throw if createLink fails", async () => {
      service.createLink.mockRejectedValue(new Error("create error"));
      await expect(
        service.processLinkCreation(linkToCreateInSDM, attachment, req, token)
      ).rejects.toThrow("create error");
    });
  });

  describe("createLink", () => {
    let service;
    let req;
    let linkToCreateInSDM;
    let credentials;
    let token;
    let parentId;
    let upIdKey;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      credentials = { user: "user", pass: "pass" };
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      token = "mockToken";
      parentId = "parentId";
      upIdKey = "upIdField";
      linkToCreateInSDM = {
        filename: "linkName",
        mimeType: "application/internet-shortcut",
        repositoryId: "repo123",
        linkUrl: "http://example.com"
      };
      req = {
        req: { url: "/MyEntity(ID=123e4567-e89b-12d3-a456-426614174000)" },
        data: { name: "linkName", url: "http://example.com" },
        reject: jest.fn()
      };
      global.attachmentIDRegex = /ID=([0-9a-fA-F-]{36})/;
      getDraftAdministrativeData_DraftUUIDForUpId.mockResolvedValue([
        { DraftAdministrativeData_DraftUUID: "uuid-123" }
      ]);
    });

    it("should update draft if createAttachment returns 201", async () => {
      createAttachment.mockResolvedValueOnce({
        status: 201,
        data: {
          succinctProperties: {
            "cmis:objectId": "objId",
            "cmis:contentStreamMimeType": "application/internet-shortcut"
          }
        }
      });
      const uuidSpy = jest.spyOn(require("@sap/cds/lib").utils, "uuid").mockReturnValue("uuid-123");

      await service.createLink(linkToCreateInSDM, credentials, token, req, parentId, upIdKey);

      expect(createAttachment).toHaveBeenCalledWith(
        linkToCreateInSDM,
        credentials,
        token,
        parentId
      );
      expect(updateLinkInDraft).toHaveBeenCalledWith(
        req,
        expect.objectContaining({
          url: "objId",
          repositoryId: "repo123",
          folderId: parentId,
          status: "Clean",
          type: "sap-icon://internet-browser",
          [upIdKey]: "123e4567-e89b-12d3-a456-426614174000",
          mimeType: "application/internet-shortcut",
          filename: "linkName",
          HasDraftEntity: false,
          HasActiveEntity: false,
          linkUrl: "http://example.com",
          DraftAdministrativeData_DraftUUID: "uuid-123"
        })
      );
      uuidSpy.mockRestore();
    });

    it("should reject with duplicateFileErr if nameConstraintViolation", async () => {
      createAttachment.mockResolvedValueOnce({
        status: 400,
        response: { data: { exception: "nameConstraintViolation" } }
      });
      const data = { filename: "linkName" };
      global.data = data;

      await service.createLink(linkToCreateInSDM, credentials, token, req, parentId, upIdKey);

      expect(req.reject).toHaveBeenCalledWith(409, duplicateFileErr(['linkName']));
    });

    it("should reject with userNotAuthorisedErrorLink if status is 403", async () => {
      createAttachment.mockResolvedValueOnce({
        status: 403,
        response: { data: {} }
      });
      const data = { filename: "linkName" };
      global.data = data;

      await service.createLink(linkToCreateInSDM, credentials, token, req, parentId, upIdKey);

      expect(req.reject).toHaveBeenCalledWith(403, "You do not have the required permissions to upload links. Please contact your administrator for access.");
    });

    it("should reject with message if other error", async () => {
      createAttachment.mockResolvedValueOnce({
        status: 400,
        response: { data: { message: "some error" } }
      });
      const data = { filename: "linkName" };
      global.data = data;

      await service.createLink(linkToCreateInSDM, credentials, token, req, parentId, upIdKey);

      expect(req.reject).toHaveBeenCalledWith("some error");
    });
  });

  describe('handleEditLinkAction', () => {
    let service;
    let req;
    let cds;
    const attachmentId = '123e4567-e89b-12d3-a456-426614174000';

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = 'test-credentials';

      req = {
        req: {
            url: `/Attachments(ID=${attachmentId})`
        },
        target: {
            name: 'Attachments'
        },
        data: {
            url: 'http://new-link.com'
        },
        user: {
          tokenInfo: {
              getTokenValue: jest.fn().mockReturnValue('test-user-token')
          }
        },
        reject: jest.fn()
      };

      cds = require('@sap/cds/lib');
      cds.model.definitions[req.target.name] = 'test-entity';
    });

    it('should successfully edit a link', async () => {
      const existingAttachment = {
          url: 'existing-object-id',
          filename: 'MyLink.url'
      };
      getAttachmentById.mockResolvedValue(existingAttachment);
      fetchAccessToken.mockResolvedValue('test-access-token');
      editLink.mockResolvedValue({ status: 200 });
      editLinkInDraft.mockResolvedValue();

      await service.handleEditLinkAction(req);

      expect(getAttachmentById).toHaveBeenCalledWith(attachmentId, 'test-entity');
      expect(fetchAccessToken).toHaveBeenCalledWith(service.creds, 'test-user-token');
      expect(editLink).toHaveBeenCalledWith(
          'existing-object-id',
          'MyLink',
          'http://new-link.com',
          service.creds,
          'test-access-token'
      );
      expect(editLinkInDraft).toHaveBeenCalledWith(req, {
          ID: attachmentId,
          linkUrl: 'http://new-link.com'
      });
      expect(req.reject).not.toHaveBeenCalled();
    });

    it('should reject with 404 if link to be edited is not found', async () => {
      getAttachmentById.mockResolvedValue(null);
      await service.handleEditLinkAction(req);
      expect(req.reject).toHaveBeenCalledWith(404, "The link you are trying to edit does not exist or invalid.");
    });

    it('should reject with a specific error message if the repository update fails', async () => {
      getAttachmentById.mockResolvedValue({ url: 'some-url', filename: 'some-file.url' });
      fetchAccessToken.mockResolvedValue('test-access-token');
      editLink.mockResolvedValue({
          status: 500,
          response: { data: { message: 'Repository Error' } }
      });
      await service.handleEditLinkAction(req);
      expect(req.reject).toHaveBeenCalledWith(500, 'Repository Error');
    });

    it('should reject with a generic error message if the repository update fails without a specific message', async () => {
      getAttachmentById.mockResolvedValue({ url: 'some-url', filename: 'some-file.url' });
      fetchAccessToken.mockResolvedValue('test-access-token');
      editLink.mockResolvedValue({ status: 500 });

      await service.handleEditLinkAction(req);

      expect(req.reject).toHaveBeenCalledWith(500, "The link you are trying to edit could not be updated in the repository.");
    });

    it('should reject with 500 on unexpected error', async () => {
      getAttachmentById.mockResolvedValue({ url: 'some-url', filename: 'some-file.url' });
      fetchAccessToken.mockResolvedValue('test-access-token');
      editLink.mockRejectedValue(new Error('Unexpected Error'));

      await service.handleEditLinkAction(req);

      expect(req.reject).toHaveBeenCalledWith(
          400,
          "Call to editLink failed with an exception",
          expect.any(Error)
      );
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
        target: {
          name: "testName",
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("mocked_token"),
          },
        },
        reject: jest.fn(),
        info: jest.fn(),
      };

      cds.model.definitions[mockReq.target.name + ".attachments"] = {
        keys: {
          up_: {
            keys: [{ ref: ["attachment"] }],
          },
        },
      };
    });

    it("getParentId should call getFolderIdByPath if getFolderIdForEntity returns empty array", async () => {
      const attachments = cds.model.definitions[mockReq.target.name + ".attachments"]
      const token = "mocked_token"
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce("mocked_folder_id");
      const upId = "mocked_up_id";

      await service.getParentId(attachments, mockReq, token, upId)
 
      expect(getFolderIdByPath).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        "mocked_token",
        cds.model.definitions[mockReq.target.name + ".attachments"],
        upId
      );
    });
  
    it("getParentId should call createFolder if getFolderIdForEntity and getFolderIdByPath return empty", async () => {
      let attachments = cds.model.definitions[mockReq.target.name + ".attachments"]
      let token = "mocked_token"
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce(null);
      const upId = "mocked_up_id"
      createFolder.mockResolvedValueOnce(
        {
          data: {
            succinctProperties: {
              "cmis:objectId": "mock_object_id"
            }
          }
        }
      );

      await service.getParentId(attachments, mockReq, token, upId);
 
      expect(createFolder).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        "mocked_token",
        cds.model.definitions[mockReq.target.name + ".attachments"],
        upId
      );
    });
  
    it("getParentId should reject with 403 if createFolder response status is 403 and message matches userDoesNotHaveRequiredScope", async () => {
      let attachments = cds.model.definitions[mockReq.target.name + ".attachments"];
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
      let attachments = cds.model.definitions[mockReq.target.name + ".attachments"];
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
        target: {
          name: "testName",
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

  describe("validateLinkName", () => {
    let service;
    let req;

    beforeEach(() => {
      service = new SDMAttachmentsService();
      req = { reject: jest.fn() };
      jest.clearAllMocks();
    });

    it("should reject if linkNameInRequest contains restricted characters", async () => {
      // Mock isRestrictedCharactersInName to return true
      require("../../lib/util").isRestrictedCharactersInName.mockReturnValue(true);
      const data = [{ filename: "file1" }];
      const linkNameInRequest = "invalid/name";

      await service.validateLinkName(data, linkNameInRequest, req);

      expect(req.reject).toHaveBeenCalledWith(
        409,
        require("../../lib/util/messageConsts").linkNameConstraintMessage([linkNameInRequest], "created")
      );
    });

    it("should reject if linkNameInRequest is duplicate", async () => {
      // Mock isRestrictedCharactersInName to return false
      require("../../lib/util").isRestrictedCharactersInName.mockReturnValue(false);
      // Mock filterDuplicates to return a duplicate
      jest.spyOn(service, "filterDuplicates").mockReturnValue(["duplicateName"]);
      const data = [{ filename: "duplicateName" }];
      const linkNameInRequest = "duplicateName";

      await service.validateLinkName(data, linkNameInRequest, req);

      expect(req.reject).toHaveBeenCalledWith(
        409,
        require("../../lib/util/messageConsts").duplicateDraftFileErr("duplicateName")
      );
    });

    it("should not reject if linkNameInRequest is valid and not duplicate", async () => {
      require("../../lib/util").isRestrictedCharactersInName.mockReturnValue(false);
      jest.spyOn(service, "filterDuplicates").mockReturnValue([]);
      const data = [{ filename: "file1" }];
      const linkNameInRequest = "uniqueName";

      await service.validateLinkName(data, linkNameInRequest, req);

      expect(req.reject).not.toHaveBeenCalled();
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
        target: {
          name: "testName.drafts",
        },
        data: {
          ID: "mocked_id",
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
      getFolderIdByIDAsPath.mockResolvedValueOnce("mock_folder_id");
  
      await service.attachDraftDeletionData(mockReq);
  
      expect(getURLsToDeleteFromDraftAttachments).toHaveBeenCalledWith("mocked_id", mockDraftAttachments);
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
        on: jest.fn(),
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

    it("should register 'openAttachment' handler and call openAttachment", async () => {
      const mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
        on: jest.fn(),
      };
      const service = new SDMAttachmentsService();
      service.openAttachment = jest.fn().mockResolvedValue("openAttachmentResult");

      service.registerUpdateHandlers(mockSrv, "entity", { drafts: "drafts" });

      // Find the handler registered for 'openAttachment'
      const openAttachmentCall = mockSrv.on.mock.calls.find(
        ([eventName]) => eventName === "openAttachment"
      );
      expect(openAttachmentCall).toBeDefined();

      // Simulate calling the handler
      const handler = openAttachmentCall[1];
      const req = { error: jest.fn() };
      const result = await handler(req);

      expect(service.openAttachment).toHaveBeenCalledWith(req);
      expect(result).toBe("openAttachmentResult");
      expect(req.error).not.toHaveBeenCalled();
    });

    it("should register 'createLink' handler and call handleCreateLinkAction", async () => {
      const mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
        on: jest.fn(),
      };
      const service = new SDMAttachmentsService();
      service.handleCreateLinkAction = jest.fn().mockResolvedValue("createLinkResult");

      service.registerUpdateHandlers(mockSrv, "entity", { drafts: "drafts" });

      // Find the handler registered for 'createLink'
      const createLinkCall = mockSrv.on.mock.calls.find(
        ([eventName]) => eventName === "createLink"
      );
      expect(createLinkCall).toBeDefined();

      // Simulate calling the handler
      const handler = createLinkCall[1];
      const req = { error: jest.fn() };
      const result = await handler(req);

      expect(service.handleCreateLinkAction).toHaveBeenCalledWith(req);
      expect(result).toBe("createLinkResult");
      expect(req.error).not.toHaveBeenCalled();
    });
  });


});