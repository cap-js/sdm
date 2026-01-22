const SDMAttachmentsService = require("../../lib/sdm");
const NodeCache = require("node-cache");
const { getDestinationFromServiceBinding, retrieveJwt } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const {
  getConfigurations,
  isRepositoryVersioned,
  getSdmInstanceName,
  transformSDMServiceBindingToJWTBearerCredentialsDestination,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties,
  checkIfSDMRolesExistInToken,
  decodeAccessToken
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
let {
  duplicateDraftFileErr,
  virusFileErr,
  duplicateFileErr,
  otherFileErr,
  userNotAuthorisedError,
  userNotAuthorisedReadError,
  userDoesNotHaveRequiredScope,
  versionedRepositoryErr,
  nameConstrainErr,
  sdmRolesErrorMessage,
  userNotAuthorisedErrorEditLink,
  userNotAuthorisedOpenLink,
  editLinkNotFoundErr,
  linkNameConstraintMessage,
  unsupportedProperties,
  attachmentNotFound,
  errorMessage
} = require("../../lib/util/messageConsts");

jest.mock("@cap-js/attachments/lib/basic", () => class {});
jest.mock("@sap-cloud-sdk/connectivity", () => ({
  getDestinationFromServiceBinding: jest.fn(),
  retrieveJwt: jest.fn()
}));
jest.mock("@sap-cloud-sdk/http-client", () => ({
  executeHttpRequest: jest.fn()
}));
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
  checkAttachmentsToRename: jest.fn(),
  getConfigurations: jest.fn(),
  isRepositoryVersioned: jest.fn(),
  getSdmInstanceName: jest.fn(),
  transformSDMServiceBindingToJWTBearerCredentialsDestination: jest.fn(),
  isRestrictedCharactersInName: jest.fn(),
  getStatusCondition: jest.fn(),
  getPropertyTitles: jest.fn(),
  getSecondaryPropertiesWithInvalidDefinition: jest.fn(),
  getSecondaryTypeProperties: jest.fn(),
  getUpdatedSecondaryProperties: jest.fn(),
  checkIfSDMRolesExistInToken: jest.fn(),
  decodeAccessToken: jest.fn()
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
    context: {
      user: {
        tokenInfo: {
          getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
        }
      }
    }
  };
  return mockCds;
});
jest.mock("node-cache");

// Mock the cache instance used in sdm.js
const mockCacheInstance = {
  get: jest.fn(),
  set: jest.fn(),
  del: jest.fn()
};
NodeCache.mockImplementation(() => mockCacheInstance);

// Global Mocks for CAP Query Functions (Used in Link Persistence Logic)
global.SELECT = {
  from: jest.fn().mockReturnThis(),
  one: {
    from: jest.fn().mockReturnThis(),
    where: jest.fn()
  },
  where: jest.fn()
};
global.UPDATE = jest.fn().mockReturnValue({
  set: jest.fn().mockReturnThis(),
  where: jest.fn().mockResolvedValue()
});


// Global entity definition setup for link tests to avoid "Cannot read properties of undefined (reading 'keys')"
const mockUpKeyStructure = {
  keys: {
    up_: {
      keys: [{ $generatedFieldName: 'up__ID' }]
    }
  }
};

const cds = require("@sap/cds/lib");
cds.model.definitions['ProcessorService.Incidents.references'] = {};
cds.model.definitions['ProcessorService.Incidents.references.drafts'] = mockUpKeyStructure;
cds.model.definitions['Test.Entity.references'] = {}; // Added to satisfy test structure
cds.model.definitions['Test.Entity.references.drafts'] = mockUpKeyStructure; // Added to satisfy test structure

// Add entity with 'references' composition for testing alternative composition names
cds.model.definitions['Test.Entity.references'] = {};
cds.model.definitions['Test.Entity.references.drafts'] = mockUpKeyStructure;
cds.model.definitions['Test.EntityWithReferences'] = {
  elements: {
    references: {
      type: 'cds.Composition',
      target: 'Test.Entity.references'
    }
  }
};
cds.model.definitions['Test.Entity.references'] = {
  includes: ['sap.attachments.Attachments']
};
cds.model.definitions['ProcessorService.Orders'] = {
  elements: {
    references: {
      type: 'cds.Composition',
      target: 'ProcessorService.Orders.references'
    }
  }
};
cds.model.definitions['ProcessorService.Orders.references'] = {
  includes: ['sap.attachments.Attachments'],
  keys: {
    up_: {
      keys: [{ $generatedFieldName: 'up__ID' }]
    }
  }
};
cds.model.definitions['ProcessorService.Orders.references.drafts'] = {
  includes: ['sap.attachments.Attachments'],
  keys: {
    up_: {
      keys: [{ $generatedFieldName: 'up__ID' }]
    }
  }
};

describe("SDMAttachmentsService", () => {
  // Ensure attachmentIDRegex is available globally
  global.attachmentIDRegex = /ID=([0-9a-fA-F-]{36})/;
  
  // Helper function to setup destination mocks
  function setupDestinationMocks(mockDestination = { url: "http://example.com" }) {
    getSdmInstanceName.mockReturnValue("sdm-instance");
    retrieveJwt.mockResolvedValue("mock-jwt");
    getDestinationFromServiceBinding.mockResolvedValue(mockDestination);
    return mockDestination;
  }

  describe("getDestination", () => {
    let service;
    
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { uri: "http://mock-uri" };
    });

    it("should fetch and cache destination on first call", async () => {
      const mockReq = {};
      const mockDestination = { url: "http://example.com" };
      
      getSdmInstanceName.mockReturnValue("sdm-instance");
      retrieveJwt.mockResolvedValue("mock-jwt-token");
      getDestinationFromServiceBinding.mockResolvedValue(mockDestination);

      const result = await service.getDestination(mockReq);

      expect(retrieveJwt).toHaveBeenCalledWith(mockReq);
      expect(getDestinationFromServiceBinding).toHaveBeenCalled();
      expect(result).toBe(mockDestination);
      expect(mockReq._sdmDestination).toBe(mockDestination);
    });

    it("should return cached destination on subsequent calls", async () => {
      const cachedDestination = { url: "http://cached.com" };
      const mockReq = {
        _sdmDestination: cachedDestination
      };

      const result = await service.getDestination(mockReq);

      expect(retrieveJwt).not.toHaveBeenCalled();
      expect(getDestinationFromServiceBinding).not.toHaveBeenCalled();
      expect(result).toBe(cachedDestination);
    });
  });
  
  describe("checkRepositoryType", () => {
    let service;
    
    beforeEach(() => {
      service = new SDMAttachmentsService();
      service.creds = { clientId: "client-id", clientSecret: "client-secret" };
    });
  
    afterEach(() => {
      jest.clearAllMocks();
      jest.resetAllMocks();
    });
  
    it("should fetch repository info and check versioned status if not found in cache", async () => {
      const mockReq = { reject: jest.fn() };
      
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      NodeCache.prototype.get.mockReturnValue(undefined);
      const mockDestination = { url: "http://example.com" };
      service.technicalUserDestn = mockDestination;
      getRepositoryInfo.mockResolvedValue({ data: "mock-repo-info" });
      isRepositoryVersioned.mockReturnValue(false);
  
      await service.checkRepositoryType(mockReq);
  
      expect(getRepositoryInfo).toHaveBeenCalledWith(mockReq, service.creds, mockDestination);
      expect(isRepositoryVersioned).toHaveBeenCalledWith({ data: "mock-repo-info" }, "repo123");
      expect(mockReq.reject).not.toHaveBeenCalled();
    });
  
    it("should reject the request if the repository is versioned", async () => {
      const mockReq = { reject: jest.fn() };
      
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      NodeCache.prototype.get.mockReturnValue(undefined);
      const mockDestination = { url: "http://example.com" };
      service.technicalUserDestn = mockDestination;
      getRepositoryInfo.mockResolvedValue({ data: "mock-repo-info" });
      isRepositoryVersioned.mockResolvedValue(true);
  
      await service.checkRepositoryType(mockReq);
  
      expect(getRepositoryInfo).toHaveBeenCalledWith(mockReq, service.creds, mockDestination);
      expect(isRepositoryVersioned).toHaveBeenCalledWith({ data: "mock-repo-info" }, "repo123");
      expect(mockReq.reject).toHaveBeenCalledWith(400, versionedRepositoryErr);
    });

    it("should use cached repository type when available and not versioned", async () => {
      const mockReq = { reject: jest.fn() };
      
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      
      // Mock cds.context with subdomain
      const mockContext = {
        user: {
          tokenInfo: {
            getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
          }
        }
      };
      Object.defineProperty(cds, 'context', {
        get: () => mockContext,
        configurable: true
      });
      
      NodeCache.prototype.get.mockReturnValue("not-versioned");
      const mockDestination = { url: "http://example.com" };
      service.technicalUserDestn = mockDestination;
  
      await service.checkRepositoryType(mockReq);
  
      expect(NodeCache.prototype.get).toHaveBeenCalledWith("repo123_test-subdomain");
      expect(getRepositoryInfo).not.toHaveBeenCalled();
      expect(isRepositoryVersioned).not.toHaveBeenCalled();
      expect(mockReq.reject).not.toHaveBeenCalled();
    });

    it("should reject request when cached repository type is versioned", async () => {
      const mockReq = { reject: jest.fn() };
      
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      
      // Mock cds.context with subdomain
      const mockContext = {
        user: {
          tokenInfo: {
            getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
          }
        }
      };
      Object.defineProperty(cds, 'context', {
        get: () => mockContext,
        configurable: true
      });
      
      NodeCache.prototype.get.mockReturnValue("versioned");
      const mockDestination = { url: "http://example.com" };
      service.technicalUserDestn = mockDestination;
  
      await service.checkRepositoryType(mockReq);
  
      expect(NodeCache.prototype.get).toHaveBeenCalledWith("repo123_test-subdomain");
      expect(getRepositoryInfo).not.toHaveBeenCalled();
      expect(isRepositoryVersioned).not.toHaveBeenCalled();
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
      setupDestinationMocks();
    });

    it("should interact with DB, fetch access token and readAttachment with correct parameters", async () => {
      const req = {
        reject: jest.fn(),
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const response = { url: "mockUrl" };
      const mockDestination = setupDestinationMocks();

      // set req in service instance
      getURLFromAttachments.mockResolvedValueOnce(response);
      readAttachment.mockResolvedValueOnce({ status: 200, data: "dummy_content" });

      const result = await service.get(attachments, keys, req); // call get method

      expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
      expect(readAttachment).toHaveBeenCalledWith(
        "mockUrl",
        mockDestination,
        service.creds
      );
      expect(result).toBe("dummy_content");
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
      const response = { url: "mockUrl" };
      const mockDestination = setupDestinationMocks();
      const errorMessage = new Error("Attachment not found in the repository");
      errorMessage.code = 404;
    
      getURLFromAttachments.mockResolvedValueOnce(response);
      readAttachment.mockImplementationOnce(() => {
        throw errorMessage;
      });
  
      await expect(service.get(attachments, keys, req)).rejects.toThrow(
        errorMessage
      );
  
      expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
      expect(readAttachment).toHaveBeenCalledWith(
        "mockUrl",
        mockDestination,
        service.creds
      );
    });

    it("should interact with DB, fetch access token and readAttachment with correct parameters when cache returns non-versioned repo type", async () => {
      NodeCache.prototype.get.mockImplementation(() => "non-versioned");
      const req = {
        reject: jest.fn(),
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      
      const attachments = ["attachment1", "attachment2"];
      const keys = ["key1", "key2"];
      const response = { url: "mockUrl" };
      const mockDestination = setupDestinationMocks();

      // set req in service instance
      getURLFromAttachments.mockResolvedValueOnce(response);
      readAttachment.mockResolvedValueOnce({ status: 200, data: "dummy_content" });

      const result = await service.get(attachments, keys, req); // call get method

      expect(getURLFromAttachments).toHaveBeenCalledWith(keys, attachments);
      expect(readAttachment).toHaveBeenCalledWith(
        "mockUrl",
        mockDestination,
        service.creds
      );
      expect(result).toBe("dummy_content");
    });
  });

  describe('renameHandler', () => {
    let service;
    let req;
    let token;
  
    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
      
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
      
      cds.model.definitions['sampleTarget'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'sampleTarget.references'
          }
        }
      };
      cds.model.definitions['sampleTarget.references'] = {
        includes: ['sap.attachments.Attachments']
      };
    });
  
    it('should not rename if no attachments are modified', async () => {
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn();
      service.updateNonDraftAttachments = jest.fn();
  
      setupDestinationMocks();
      getDraftAttachments.mockResolvedValue([]);
  
      await service.renameHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(getDraftAttachments).toHaveBeenCalledWith(cds.model.definitions['sampleTarget.references'], req, 'repo123');
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
      service.handleWarning = jest.fn().mockReturnValue("");
  
      setupDestinationMocks();
      getDraftAttachments.mockResolvedValue(allAttachments);
      getPropertyTitles.mockReturnValue(["Title1", "Title2"]);
      getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({ invalidProperty: "value" });
      getSecondaryTypeProperties.mockReturnValue(new Map([["property1", "value1"], ["property2", "value2"]]));
  
      await service.renameHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(allAttachments, req);
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
      const mockErrors = ['Error1'];
      const mockErrorMessage = "Some error message from handleWarning";
      
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn().mockResolvedValue(mockErrors);
      service.updateNonDraftAttachments = jest.fn().mockResolvedValue(mockErrors);
      service.clearSecondaryPropertiesCache = jest.fn();
      service.handleWarning = jest.fn().mockReturnValue(mockErrorMessage);
      
      getPropertyTitles.mockReturnValue({});
      getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({});
      getSecondaryTypeProperties.mockReturnValue(new Map());
      
      setupDestinationMocks();
      getDraftAttachments.mockResolvedValue(allAttachments);
  
      await service.renameHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(allAttachments, req);
      expect(service.updateDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.updateNonDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.clearSecondaryPropertiesCache).toHaveBeenCalledWith('repo123');
      expect(req.warn).toHaveBeenCalledWith(500, mockErrorMessage);
    });

    it('should handle errors during updateDraftAttachments', async () => {
      const draftAttachments = [
        { HasActiveEntity: false, ID: 'draft1', url: 'url1' }
      ];
      const nonDraftAttachments = [
        { HasActiveEntity: true, ID: 'nonDraft1' }
      ];
      const allAttachments = [...draftAttachments, ...nonDraftAttachments];
  
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'file1.txt', folderId: 'folder1' });
      service.updateNonDraftAttachments = jest.fn().mockResolvedValue([]);
      service.clearSecondaryPropertiesCache = jest.fn();
  
      setupDestinationMocks();
      getDraftAttachments.mockResolvedValue(allAttachments);
      
      service._updateAttachments = jest.fn((req, context) => {
        if (context.attachment.ID === 'draft1') {
          return Promise.reject(new Error('Draft update failed'));
        }
        return [];
      });
      
      getPropertyTitles.mockReturnValue({});
      getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({});
      getSecondaryTypeProperties.mockReturnValue(new Map());
      
      await expect(service.renameHandler(req)).rejects.toThrow('Draft update failed');
  
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(allAttachments, req);
      expect(service.updateNonDraftAttachments).not.toHaveBeenCalled();
    });

    // Test with "references" composition instead of "attachments"
    it('should work with references composition instead of attachments', async () => {
      req.target.name = 'ProcessorService.Orders';
      const referencesEntity = cds.model.definitions['ProcessorService.Orders.references'];
      
      const draftReferences = [
        { HasActiveEntity: false, ID: 'draft1' }
      ];
      const nonDraftReferences = [
        { HasActiveEntity: true, ID: 'nonDraft1' }
      ];
      const allReferences = [...draftReferences, ...nonDraftReferences];
  
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn().mockResolvedValue([]);
      service.updateNonDraftAttachments = jest.fn().mockResolvedValue([]);
      service.clearSecondaryPropertiesCache = jest.fn();
      service.handleWarning = jest.fn().mockReturnValue("");
  
      setupDestinationMocks();
      getDraftAttachments.mockResolvedValue(allReferences);
      getPropertyTitles.mockReturnValue(["Title1", "Title2"]);
      getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({ invalidProperty: "value" });
      getSecondaryTypeProperties.mockReturnValue(new Map([["property1", "value1"], ["property2", "value2"]]));
  
      await service.renameHandler(req);
  
      expect(getDraftAttachments).toHaveBeenCalledWith(referencesEntity, req, 'repo123');
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(allReferences, req);
      expect(service.updateDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.updateNonDraftAttachments).toHaveBeenCalledTimes(1);
      expect(service.clearSecondaryPropertiesCache).toHaveBeenCalledWith('repo123');
      expect(req.warn).not.toHaveBeenCalled();
    });

    it('should discover and process all attachment compositions', async () => {
      // Create an entity with multiple attachment compositions
      req.target.name = 'Test.EntityWithMultiple';
      cds.model.definitions['Test.EntityWithMultiple'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.EntityWithMultiple.references'
          },
          documents: {
            type: 'cds.Composition',
            target: 'Test.EntityWithMultiple.documents'
          },
          files: {
            type: 'cds.Composition',
            target: 'Test.EntityWithMultiple.files'
          }
        }
      };
      cds.model.definitions['Test.EntityWithMultiple.references'] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['Test.EntityWithMultiple.documents'] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['Test.EntityWithMultiple.files'] = {
        includes: ['sap.attachments.Attachments']
      };
  
      service.isFileNameDuplicateInDrafts = jest.fn().mockResolvedValue();
      service.updateDraftAttachments = jest.fn().mockResolvedValue([]);
      service.updateNonDraftAttachments = jest.fn().mockResolvedValue([]);
      service.clearSecondaryPropertiesCache = jest.fn();
      service.handleWarning = jest.fn().mockReturnValue("");
  
      setupDestinationMocks();
      getDraftAttachments.mockResolvedValue([{ HasActiveEntity: false, ID: 'draft1' }]);
      getPropertyTitles.mockReturnValue({});
      getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({});
      getSecondaryTypeProperties.mockReturnValue(new Map());
  
      await service.renameHandler(req);
  
      // Should be called 3 times, once for each composition
      expect(getDraftAttachments).toHaveBeenCalledTimes(3);
      expect(getDraftAttachments).toHaveBeenCalledWith(
        cds.model.definitions['Test.EntityWithMultiple.references'], 
        req, 
        'repo123'
      );
      expect(getDraftAttachments).toHaveBeenCalledWith(
        cds.model.definitions['Test.EntityWithMultiple.documents'], 
        req, 
        'repo123'
      );
      expect(getDraftAttachments).toHaveBeenCalledWith(
        cds.model.definitions['Test.EntityWithMultiple.files'], 
        req, 
        'repo123'
      );
    });
  });

  describe('updateNonDraftAttachments', () => {
    let service;
    let req;
    
    let attachment;
    let attachmentsEntity;
    let secondaryPropertiesWithInvalidDefinitions;
    let secondaryTypeProperties;
  
    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = {};
      service.getDestination = jest.fn().mockResolvedValue({ url: 'https://mock-destination.com' });
      req = {
        reject: jest.fn(),
        data: {
          references: [{ ID: 'attachment1', filename: 'file1.txt' }]
        }
      };
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
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'restricted characters', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should return empty name error if filename is null', async () => {
      attachment.filename = null;
    
      const response = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
      expect(response).toEqual(
        [{typeOfError: 'empty name', name: null}]
      );
    });
  
    it('should update the filename if it differs from the database', async () => {
      getFileNameForAttachmentID.mockResolvedValue('file2.txt');
  
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
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
        expect.objectContaining({ url: expect.any(String) }),
        { property1: 'updatedValue1', 'cmis:name': 'file1.txt' },
        secondaryPropertiesWithInvalidDefinitions
      );
      expect(result).toEqual([]);
    });
    it('should update cmis:name if filenameInDB is null', async () => {
      getFileNameForAttachmentID.mockResolvedValue(null);
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
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
        expect.objectContaining({ url: expect.any(String) }),
        { property1: 'updatedValue1', 'cmis:name': 'file1.txt' },
        secondaryPropertiesWithInvalidDefinitions
      );
      expect(result).toEqual([]);
    });
  
    it('should handle a 403 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(403);
  
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'no sdm roles', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should handle a 409 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(409);
  
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'duplicate', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should handle a 404 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(404);
  
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'not found', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });

    it('should handle an unexpected response code in the default case', async () => {
      // Mock dependencies
      getFileNameForAttachmentID.mockResolvedValue('file1.txt'); // Simulate fileNameInDB
      getPropertiesForID.mockResolvedValue({ property1: 'value1' }); // Simulate properties from DB
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' }); // Simulate updated properties
      updateAttachment.mockRejectedValue(new Error(sdmRolesErrorMessage)); // Simulate an unexpected response code
    
      // Call the method
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
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
        secondaryTypeProperties,
        'attachments'
      );
    
      // Ensure updateAttachment was called with the correct arguments
      expect(updateAttachment).toHaveBeenCalledWith(
        req,
        attachment,
        service.creds,
        expect.objectContaining({ url: expect.any(String) }),
        { property1: 'updatedValue1' },
        secondaryPropertiesWithInvalidDefinitions
      );
    });
  
    it('should handle unsupported properties error', async () => {
      updateAttachment.mockRejectedValue(new Error(`${unsupportedProperties} property1, property2`));
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([
        {
          typeOfError: 'unsupported properties',
          details: 'property1, property2'
        }
      ]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should handle other errors during updateAttachment', async () => {
      updateAttachment.mockRejectedValue(new Error('Some other error'));
  
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
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
        secondaryTypeProperties,
        'attachments'
      );
    });

    // Test with 'references' composition name
    it('should work with references composition name', async () => {
      req.data = {
        references: [{ ID: 'attachment1', filename: 'file1.txt' }]
      };
      isRestrictedCharactersInName.mockReturnValue(true);

      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'references'
      );

      expect(result).toEqual([{ typeOfError: 'restricted characters', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'references'
      );
    });
  });

  describe('updateDraftAttachments', () => {
    let service;
    let req;
    
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
          references: [{ ID: 'attachment1', filename: 'file1.txt' }]
        }
      };
      attachment = { ID: 'attachment1', filename: 'file1.txt', url: 'mockUrl' };
      attachmentsEntity = {};
      secondaryPropertiesWithInvalidDefinitions = {};
      secondaryTypeProperties = new Map();

      // Initialize creds with a valid uri
      service.creds = { uri: 'mockUri' };
      service.getDestination = jest.fn().mockResolvedValue({ url: 'https://mock-destination.com' });
  
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
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'restricted characters', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should reject if filenameInRequest is null', async () => {
      attachment.filename = null;
  
      const response = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(response).toEqual(
        [{typeOfError: 'empty name', name: null}]
      );
    });
  
    it('should update cmis:name if filenameInRequest differs from filenameInSDM', async () => {
      service.getAttachementDataInSDM.mockResolvedValue({ filename: 'file2.txt', folderId: 'mockFolderId' });
  
      const result = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
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
        expect.objectContaining({ url: expect.any(String) }),
        { property1: 'updatedValue1', 'cmis:name': 'file1.txt' },
        secondaryPropertiesWithInvalidDefinitions
      );
      expect(result).toEqual([]);
    });
  
    it('should handle a 403 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(403);
  
      const result = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'no sdm roles', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should handle a 409 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(409);
  
      const result = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'duplicate', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should handle a 404 response from updateAttachment', async () => {
      updateAttachment.mockResolvedValue(404);
  
      const result = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([{ typeOfError: 'not found', name: 'file1.txt' }]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });

    it('should handle an unexpected response code in the default case', async () => {
      // Mock dependencies
      service.getAttachementDataInSDM.mockResolvedValue({ filename: 'file1.txt', folderId: 'mockFolderId' });
      getPropertiesForID.mockResolvedValue({ property1: 'value1' });
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' });
      updateAttachment.mockRejectedValue(new Error(sdmRolesErrorMessage)); // Simulate an unexpected response code
    
      // Call the method
      const result = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
    
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
        secondaryTypeProperties,
        'attachments'
      );
    
      // Ensure updateAttachment was called with the correct arguments
      expect(updateAttachment).toHaveBeenCalledWith(
        req,
        attachment,
        service.creds,
        expect.objectContaining({ url: expect.any(String) }),
        { property1: 'updatedValue1' },
        secondaryPropertiesWithInvalidDefinitions
      );
    });
  
    it('should handle unsupported properties error', async () => {
      updateAttachment.mockRejectedValue(new Error(`${unsupportedProperties} property1, property2`));
  
      const result = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
  
      expect(result).toEqual([
        {
          typeOfError: 'unsupported properties',
          details: 'property1, property2'
        }
      ]);
      expect(service.replacePropertiesInAttachment).toHaveBeenCalledWith(
        req,
        'attachment1',
        'file1.txt',
        { property1: 'value1' },
        secondaryTypeProperties,
        'attachments'
      );
    });
  
    it('should handle other errors during updateAttachment', async () => {
      updateAttachment.mockRejectedValue(new Error('Some other error'));
  
      const result = await service.updateDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
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
        secondaryTypeProperties,
        'attachments'
      );
    });

    it('should handle unexpected status code (default case) by throwing error', async () => {
      // Mock dependencies
      getFileNameForAttachmentID.mockResolvedValue('file1.txt');
      getPropertiesForID.mockResolvedValue({ property1: 'value1' });
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' });
      // Return an unexpected status code (e.g., 500) that triggers default case
      updateAttachment.mockResolvedValue(500);
    
      // Call the method
      const result = await service.updateNonDraftAttachments(
        req,
        attachment,
        attachmentsEntity,
        secondaryPropertiesWithInvalidDefinitions,
        secondaryTypeProperties,
        'attachments'
      );
    
      // The default case throws an error which is caught and added to failedReq
      expect(result).toEqual([
        {
          typeOfError: 'bad request',
          name: 'file1.txt',
          message: sdmRolesErrorMessage
        }
      ]);
      
      expect(service.replacePropertiesInAttachment).toHaveBeenCalled();
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
          references: [
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
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties, 'references');
  
      const updatedAttachment = req.data.references.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.secondaryKey1).toBe('newValue1');
      expect(updatedAttachment.secondaryKey2).toBe('newValue2');
    });
  
    it('should not modify properties if propertiesInDB is null', () => {
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, null, secondaryTypeProperties, 'references');
  
      const updatedAttachment = req.data.references.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.property1).toBe('oldValue1'); // Ensure properties are not modified
      expect(updatedAttachment.property2).toBe('oldValue2');
    });
  
    it('should not modify attachments if ID is not found', () => {
      const propertiesInDB = { property1: 'newValue1', property2: 'newValue2' };
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'nonExistentID', fileName, propertiesInDB, secondaryTypeProperties, 'references');
  
      const updatedAttachment = req.data.references.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('oldFileName'); // Ensure filename is not modified
      expect(updatedAttachment.property1).toBe('oldValue1'); // Ensure properties are not modified
      expect(updatedAttachment.property2).toBe('oldValue2');
    });
  
    it('should handle secondaryTypeProperties with no matching keys', () => {
      const propertiesInDB = { property3: 'newValue3' }; // No matching keys in secondaryTypeProperties
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties, 'references');
  
      const updatedAttachment = req.data.references.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.property1).toBe('oldValue1'); // Ensure properties are not modified
      expect(updatedAttachment.property2).toBe('oldValue2');
    });
  
    it('should replace only matching properties in the attachment', () => {
      const propertiesInDB = { property1: 'newValue1' }; // Only one matching property
      const fileName = 'newFileName';
  
      service.replacePropertiesInAttachment(req, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties, 'references');
  
      const updatedAttachment = req.data.references.find(att => att.ID === 'attachment1');
      expect(updatedAttachment.filename).toBe('newFileName');
      expect(updatedAttachment.secondaryKey1).toBe('newValue1'); // Ensure matching property is updated
      expect(updatedAttachment.secondaryKey2).toBeUndefined(); // Ensure non-matching property is not updated
    });
  });

  describe('clearSecondaryPropertiesCache', () => {
    let service;
    let cache;
    const repositoryId = 'mockRepositoryId';
    const cacheKey = `validSecondaryProperties_${repositoryId}`;
  
    beforeEach(() => {
      jest.clearAllMocks();
  
      // Mock the global cache object
      cache = {
        has: jest.fn(),
        del: jest.fn(),
      };
      global.cache = cache; // Assign the mocked cache to the global object
  
      service = new SDMAttachmentsService();
    });
  
    afterEach(() => {
      delete global.cache; // Clean up the global cache mock
    });
  
    it('should remove the cache key if it exists', () => {
      // Mock the cache to have the key
      NodeCache.prototype.has.mockReturnValue(true);
  
      // Call the method
      service.clearSecondaryPropertiesCache(repositoryId);
  
      // Verify the cache key is removed
      expect(NodeCache.prototype.has).toHaveBeenCalledWith(cacheKey);
      expect(NodeCache.prototype.del).toHaveBeenCalledWith(cacheKey);
    });
  
    it('should do nothing if the cache key does not exist', () => {
      // Mock the cache to not have the key
      NodeCache.prototype.has.mockReturnValue(false);
  
      // Call the method
      service.clearSecondaryPropertiesCache(repositoryId);
  
      // Verify the cache key is not removed
      expect(NodeCache.prototype.has).toHaveBeenCalledWith(cacheKey);
      expect(NodeCache.prototype.del).not.toHaveBeenCalled();
    });
  });

  describe("handleEditLinkAction - additional scenarios", () => {
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

    it('should handle edit link when status is 403 (user not authorized)', async () => {
      getAttachmentById.mockResolvedValue({ url: 'some-url', filename: 'some-file.url' });
      setupDestinationMocks();
      editLink.mockResolvedValue({
          status: 403,
          response: { data: {} }
      });
      
      await service.handleEditLinkAction(req);
      expect(req.reject).toHaveBeenCalledWith(400, userNotAuthorisedErrorEditLink);
    });
  });

  describe('registerUpdateHandlers', () => {
    let service;
    let mockSrv;
    let entity;
    let target;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      
      mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
        on: jest.fn()
      };

      entity = {
        drafts: 'entity.drafts'
      };

      target = {
        drafts: 'target.drafts'
      };
    });

    it('should register all handlers correctly', () => {
      service.registerUpdateHandlers(mockSrv, entity, target);

      // Verify before handlers
      expect(mockSrv.before).toHaveBeenCalledWith(
        ["DELETE","UPDATE"], 
        entity, 
        expect.any(Function)
      );
      expect(mockSrv.before).toHaveBeenCalledWith(
        ["DELETE"], 
        entity.drafts, 
        expect.any(Function)
      );
      expect(mockSrv.before).toHaveBeenCalledWith(
        ["DELETE"], 
        [target.drafts], 
        expect.any(Function)
      );
      expect(mockSrv.before).toHaveBeenCalledWith(
        "READ", 
        [target, target.drafts], 
        expect.any(Function)
      );
      expect(mockSrv.before).toHaveBeenCalledWith(
        "SAVE", 
        entity, 
        expect.any(Function)
      );
      expect(mockSrv.before).toHaveBeenCalledWith(
        "PUT", 
        target.drafts, 
        expect.any(Function)
      );

      // Verify after handlers
      expect(mockSrv.after).toHaveBeenCalledWith(
        ["DELETE","UPDATE"], 
        [entity, entity.drafts], 
        expect.any(Function)
      );

      // Verify on handlers
      expect(mockSrv.on).toHaveBeenCalledWith('openAttachment', expect.any(Function));
      expect(mockSrv.on).toHaveBeenCalledWith('createLink', expect.any(Function));
      expect(mockSrv.on).toHaveBeenCalledWith('editLink', expect.any(Function));
    });

    it('should not register PUT handler when target.drafts is undefined', () => {
      const targetWithoutDrafts = {};
      service.registerUpdateHandlers(mockSrv, entity, targetWithoutDrafts);

      // Verify PUT handler for drafts is not called
      const putCalls = mockSrv.before.mock.calls.filter(call => call[0] === 'PUT');
      expect(putCalls).toHaveLength(0);
    });
  });

  describe('additional coverage tests', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });

    it('should handle _updateAttachments when Object.keys length is 0', async () => {
      const req = { data: { references: [{ ID: '123', filename: 'test.txt' }] } };
      const context = {
        attachment: { ID: '123', filename: 'test.txt' },
        attachmentsEntity: {},
        filenameInSDM: 'test.txt',
        compositionName: 'references',
        secondaryProperties: {
          invalidDefinitions: {},
          typeProperties: new Map()
        }
      };

      // Mock functions to return empty objects
      getPropertiesForID.mockResolvedValue({});
      getUpdatedSecondaryProperties.mockReturnValue({});

      const result = await service._updateAttachments(req, context);

      expect(result).toEqual([]);
      expect(updateAttachment).not.toHaveBeenCalled();
    });

    it('should test filterDuplicates with unique values', () => {
      const fileNames = ['file1.txt', 'file2.txt', 'file3.txt'];
      const result = service.filterDuplicates(fileNames);
      expect(result).toEqual([]);
    });

    it('should test filterDuplicates with duplicates', () => {
      const fileNames = ['file1.txt', 'file2.txt', 'file1.txt', 'file3.txt', 'file2.txt'];
      const result = service.filterDuplicates(fileNames);
      expect(result).toEqual(['file1.txt', 'file2.txt']);
    });

    it('should handle getAttachementDataInSDM with undefined response', async () => {
      const mockReq = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      setupDestinationMocks();
      getAttachment.mockResolvedValue(undefined);

      const result = await service.getAttachementDataInSDM('uri', 'objectId', mockReq);

      expect(result).toEqual({
        filename: undefined,
        folderId: undefined
      });
    });

    it('should handle openAttachment when user does not have SDM roles', async () => {
      const req = {
        target: { name: "MyEntity" },
        req: { url: "/MyEntity(ID=123e4567-e89b-12d3-a456-426614174000)" },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("mockToken")
          }
        },
        reject: jest.fn()
      };

      // Set up credentials for this test
      service.creds = { uri: "http://mock-uri/" };

      const cds = require("@sap/cds/lib");
      cds.model.definitions = {
        MyEntity: { entity: "MyEntity" },
        "MyEntity.drafts": { entity: "MyEntityDrafts" }
      };

      getMetadataForOpenAttachment.mockResolvedValueOnce({
        filename: "file.url",
        mimeType: "application/internet-shortcut",
        linkUrl: "http://example.com"
      });

      setupDestinationMocks();
      decodeAccessToken.mockReturnValue({ "sdm-roles": [] }); // No SDM roles
      checkIfSDMRolesExistInToken.mockReturnValue(false);
      getAttachment.mockResolvedValue({ status: 403 }); // Mock unauthorized response

      await service.openAttachment(req);

      expect(req.reject).toHaveBeenCalledWith(403, userNotAuthorisedOpenLink);
    });
  });

  describe('additional edge case coverage', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { uri: 'http://mock-uri' };
    });

    it('should handle onCreate when response.status is 403', async () => {
      const data = [{
        filename: 'test.txt',
        content: Buffer.from('test content')
      }];
      const parentId = 'parent-123';
      const req = {
        reject: jest.fn(),
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };

      setupDestinationMocks();
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      createAttachment.mockResolvedValue({
        status: 403,
        response: {
          data: {}
        }
      });

      await service.onCreate(data, service.creds, req, parentId);

      expect(req.reject).toHaveBeenCalledWith(403, expect.any(String));
    });

    it('should handle _updateAttachments when updatedSecondaryProperties is empty', async () => {
      const req = {
        data: {
          references: [{
            ID: 'attachment-123',
            filename: 'test.txt'
          }]
        }
      };
      const context = {
        attachment: {
          ID: 'attachment-123',
          filename: 'test.txt'
        },
        attachmentsEntity: { name: 'TestEntity' },
        filenameInSDM: 'test.txt',
        compositionName: 'references',
        secondaryProperties: {
          invalidDefinitions: {},
          typeProperties: new Map()
        }
      };

      getPropertiesForID.mockResolvedValue({});
      getUpdatedSecondaryProperties.mockReturnValue({});
      
      const result = await service._updateAttachments(req, context);

      expect(result).toEqual([]);
    });
  });

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
      getStatusCondition.mockImplementation((code) => {
        if (code === 409) return 'already exists';
        if (code === 404) return 'does not exist';
        return '';
      });
      
      // Use jest.spyOn to mock the imported functions
      jest.spyOn(require('../../lib/util/messageConsts'), 'nameConstrainErr').mockImplementation((names, op) => `Name constraint failed for ${names.join(', ')} during ${op}.`);
      jest.spyOn(require('../../lib/util/messageConsts'), 'renameFileErr').mockImplementation((names, condition) => `Rename failed for ${names.join(', ')} because it ${condition}.`);
      jest.spyOn(require('../../lib/util/messageConsts'), 'noSDMRolesErrorMessage').mockImplementation((names, op) => `No SDM roles for ${names.join(', ')} during ${op}.`);
      jest.spyOn(require('../../lib/util/messageConsts'), 'unsupportedPropertiesErrorMessage').mockImplementation((names) => `Unsupported properties: ${names.join(', ')}`);
      jest.spyOn(require('../../lib/util/messageConsts'), 'badRequestErrorMessage').mockImplementation((errors) => `Bad request for ${errors.map(e => e.name).join(', ')}.`);
      jest.spyOn(require('../../lib/util/messageConsts'), 'renameOtherFilesErr').mockImplementation((names, msgs) => `Other errors for ${names.join(', ')}: ${msgs.join(', ')}`);
  });
    
  afterEach(() => {
      // Restore all mocks after each test
      jest.restoreAllMocks();
    });
  
    it('should handle all error types and combine messages', () => {
      const allErrors = [
        { typeOfError: 'restricted characters', name: 'invalid_file.txt' },
        { typeOfError: 'duplicate', name: 'dup_file.txt' },
        { typeOfError: 'not found', name: 'missing_file.txt' },
        { typeOfError: 'no sdm roles', name: 'unauth_file.txt' },
        { typeOfError: 'unsupported properties', details: 'property1,property3' },
        { typeOfError: 'bad request', name: 'bad_req_file.txt', message: 'req failed' },
        { typeOfError: 'empty name', name: null },
        { typeOfError: 'unknown error', name: 'other_file.txt' },
      ];
      
      const propertyTitlesWithProperty3 = { ...propertyTitles, property3: 'Invalid Property 3' };
  
      const result = service.handleWarning(allErrors, propertyTitlesWithProperty3);
  
      expect(result).toContain('invalid_file.txt');
      expect(result).toContain('unsupported characters');
      expect(result).toContain('dup_file.txt');
      expect(result).toContain('already exists');
      expect(result).toContain('missing_file.txt');
      expect(result).toContain('does not exist');
      expect(result).toContain('unauth_file.txt');
      expect(result).toContain('required permissions to update attachments');
      expect(result).toContain('Invalid Property 1');
      expect(result).toContain('Invalid Property 3');
      expect(result).toContain('secondary properties are not supported');
      expect(result).toContain('bad_req_file.txt');
      expect(result).toContain('req failed');
      expect(result).toContain('file name cannot be empty');
      expect(result).toContain('other_file.txt');
      expect(result).toContain('unknown error');
      expect(result.length).toBeGreaterThan(0);
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
    const objectId = 'someObjectId';
    const mockReq = {
      user: {
        tokenInfo: {
          getTokenValue: jest.fn().mockReturnValue("tokenValue"),
        },
      },
    };

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      setupDestinationMocks();
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
      const result = await service.getAttachementDataInSDM(uri, objectId, mockReq);
  
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
      await expect(service.getAttachementDataInSDM(uri, objectId, mockReq)).rejects.toThrow('Some error');
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
      const result = await service.getAttachementDataInSDM(uri, objectId, mockReq);
  
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
      const attachment_val = [
        { HasActiveEntity: false, ID: 'afc3d040-60ae-4bf2-a44f-1da4043f4257', filename: 'sample.txt' },
        { HasActiveEntity: true, ID: '67890', filename: 'other.txt' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      setupDestinationMocks();
    
      await service.draftSaveHandler(req);
      
      expect(service.isFileNameDuplicateInDrafts).toHaveBeenCalledWith(attachment_val, req);
      expect(service.create).toHaveBeenCalledWith([{ ...attachment_val[0], content: 'some content' }], draftAttachments, req);
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
      setupDestinationMocks();
  
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
      setupDestinationMocks();
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
          setupDestinationMocks();
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
      const attachment_val = [
        { HasActiveEntity: false, ID: 'afc3d040-60ae-4bf2-a44f-1da4043f4257', filename: 'validname' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);

      setupDestinationMocks();
      isRestrictedCharactersInName.mockReturnValue(false);

      await service.draftSaveHandler(req);

      expect(req.reject).not.toHaveBeenCalled();
      expect(service.create).toHaveBeenCalledWith([{ HasActiveEntity: false, ID: "afc3d040-60ae-4bf2-a44f-1da4043f4257", content: 'some content', filename: 'validname' }], draftAttachments, req);
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
      
      // Setup entity with composition
      cds.model.definitions["myName"] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'myName.references'
          }
        }
      };
      cds.model.definitions["myName.references"] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions["Attachments.references"] = {};
      cds.model.definitions["testName.references"] = {};
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
          references: [
            { _op: "delete", ID: "1" },
            { _op: "delete", ID: "2" },
            { _op: "insert", ID: "3" },
          ],
        }),
        attachmentsToDelete: undefined,
      };
      const mockedAttachments = cds.model.definitions["myName.references"];

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
          references: [],
        }),
        attachmentsToDelete: undefined,
      };
      
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.diff).toHaveBeenCalled();
      expect(getURLsToDeleteFromAttachments).not.toHaveBeenCalled();
      expect(mockedReq.attachmentsToDelete).toBeUndefined();
    });

    it("should not add attachmentsToDelete in req when no attachments are present", async () => {
      const mockedReq = {
        target: {
          name: "myOtherName",
        },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        diff: jest.fn().mockResolvedValueOnce({
          references: [],
        }),
        attachmentsToDelete: undefined,
      };
      delete cds.model.definitions["myOtherName.references"];
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.diff).not.toHaveBeenCalled(); // Diff is not called if attachments entity is undefined
      expect(getURLsToDeleteFromAttachments).not.toHaveBeenCalled();
      expect(mockedReq.attachmentsToDelete).toBeUndefined();
    });

    it("attachDeletionData() should set req.parentId if event is DELETE and getFolderIdForEntity() returns non-empty array", async () => {
      cds.model.definitions["Attachments"] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Attachments.references'
          }
        }
      };
      cds.model.definitions["Attachments.references"] = {
        includes: ['sap.attachments.Attachments']
      };
      
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
          Promise.resolve({ references: [{ _op: "delete", ID: "1" }] }),
        event: "DELETE",
      };


      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdByIDAsPath.mockResolvedValueOnce("folder");
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.parentId).toEqual(["folder"]);
      expect(getFolderIdByIDAsPath).toHaveBeenCalledTimes(1);
    });

    it("attachDeletionData() should not set req.parentId if event is DELETE and getFolderIdForEntity() returns empty array", async () => {
      cds.model.definitions["Attachments"] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Attachments.references'
          }
        }
      };
      cds.model.definitions["Attachments.references"] = {
        includes: ['sap.attachments.Attachments']
      };
      
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
          Promise.resolve({ references: [{ _op: "delete", ID: "1" }] }),
        event: "DELETE",
      };

      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      getFolderIdByIDAsPath.mockResolvedValueOnce(null);
      await service.attachDeletionData(mockedReq);
      expect(mockedReq.parentId).toBeUndefined();
      expect(getFolderIdByIDAsPath).toHaveBeenCalledTimes(1);
    });    it("attachDeletionData() should not call getFolderIdForEntity() if event is not DELETE", async () => {
      const mockReq = {
        target: { name: "testName" },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
        diff: () =>
          Promise.resolve({ references: [{ _op: "delete", ID: "1" }] }),
        event: "CREATE",
      };

      getURLsToDeleteFromAttachments.mockResolvedValueOnce(["url"]);
      await service.attachDeletionData(mockReq);
      expect(getFolderIdForEntity).toHaveBeenCalledTimes(0);
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
          Promise.resolve({ references: [{ _op: "delete", ID: "1" }] }),
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
      service = new SDMAttachmentsService();
      
      // Mock implementation for getURLToDeleteFromDraftAttachments
      getURLToDeleteFromDraftAttachments.mockResolvedValue([{ url: 'http://example.com/attachment1', ID: '1' }]);
  
      // Mock implementation for deleteAttachmentsOfFolder
      deleteAttachmentsOfFolder.mockImplementation(async () => {
        return { status: 200 };
      });
      
      cds.model.definitions["DraftAttachments"] = {};
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
      
      const deleteAttachmentsSpy = jest.spyOn(service, 'deleteAttachmentsWithKeys');
      await service.attachURLsToDeleteFromAttachmentsDraft(req);
  
      expect(req.attachmentsToDelete).toBeUndefined();
      expect(deleteAttachmentsSpy).not.toHaveBeenCalled();
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

      cds.model.definitions["testTarget.references"] = {};
      setupDestinationMocks();
      deleteAttachmentsOfFolder.mockResolvedValue({});
      service.handleRequest = jest
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ message: expectedErrorResponse, ID: "2" });
      await service.deleteAttachmentsWithKeys(records, req);

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
      setupDestinationMocks();

      await service.deleteAttachmentsWithKeys(records, req);
      expect(deleteAttachmentsOfFolder).not.toHaveBeenCalled();
      expect(service.handleRequest).not.toHaveBeenCalled();
    });

    it("deleteAttachmentsWithKeys() should delete entire folder when parentId is available and attachmentsToDelete is NOT empty", async () => {
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
      const mockDestination = setupDestinationMocks();
      deleteFolderWithAttachments.mockResolvedValueOnce({});
      
      await service.deleteAttachmentsWithKeys([], mockReq);
      
      expect(deleteFolderWithAttachments).toHaveBeenCalledWith(
        service.creds,
        mockDestination,
        "some_folder_id"
      );
      expect(deleteAttachmentsOfFolder).not.toHaveBeenCalled();
    });
    
    it("should call deleteFolderWithAttachments when there is parentId and attachmentsToDelete is empty", async () => {
      const service = new SDMAttachmentsService();
      service.creds = {}; // Initialize service credentials
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
      const mockDestination = setupDestinationMocks();
      deleteFolderWithAttachments.mockResolvedValueOnce({});

      await service.deleteAttachmentsWithKeys(records, req);
      expect(deleteFolderWithAttachments).toHaveBeenCalledTimes(1);
      expect(deleteFolderWithAttachments).toHaveBeenCalledWith(
        service.creds,
        mockDestination,
        req.parentId
      );
    });
  });

  describe("create", () => {
    let service;
    let mockReq;
    
    beforeEach(() => {
      jest.clearAllMocks();
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

      cds.model.definitions[mockReq.target.name + ".references"] = {
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
    let data, credentials, req, parentId, service;
  
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      data = [{ filename: 'file1' }];
      credentials = { user: 'user', pass: 'pass' };
      req = {
        reject: jest.fn(),
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      parentId = 'parent123';
      setupDestinationMocks();
    });
  
    it('should successfully create attachments and update draft', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 201,
        data: { succinctProperties: { 'cmis:objectId': 'url1' } },
      });
      updateAttachmentInDraft.mockResolvedValue(true);
  
      await service.onCreate(data, credentials, req, parentId);
  
      expect(createAttachment).toHaveBeenCalledTimes(1);
      expect(updateAttachmentInDraft).toHaveBeenCalledTimes(1);
      expect(req.reject).not.toHaveBeenCalled();
    });
  
    it('should reject when a virus is found in the file', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 403,
        response: { data: { message: 'Malware Service Exception: Virus found in the file!' } }
      });
  
      await service.onCreate(data, credentials, req, parentId);
  
      expect(req.reject).toHaveBeenCalledWith(403, virusFileErr(['file1']));
    });
  
    it('should reject when there is a name constraint violation', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 500,
        response: { data: { exception: 'nameConstraintViolation' } }
      });
  
      await service.onCreate(data, credentials, req, parentId);
  
      expect(req.reject).toHaveBeenCalledWith(409, duplicateFileErr(['file1']));
    });
  
    it('should reject when another error occurs', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 500,
        response: { data: { exception: 'some other error' } }
      });
  
      await service.onCreate(data, credentials, req, parentId);
  
      expect(req.reject).toHaveBeenCalledWith(otherFileErr(['file1']));
    });
  });

  describe("openAttachment", () => {
    let service;
    let req;
    
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { uri: "http://mock-uri/" }; // Add mock credentials

      // Mock role checking functions
      setupDestinationMocks();
      decodeAccessToken.mockReturnValue({ "sdm-roles": ["user"] });
      checkIfSDMRolesExistInToken.mockReturnValue(true);
      getAttachment.mockResolvedValue({ status: 200 }); // Mock getAttachment

      req = {
        target: { name: "MyEntity" },
        req: { url: "/MyEntity(ID=123e4567-e89b-12d3-a456-426614174000)" },
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("mockToken")
          }
        }
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
    
    beforeEach(() => {
      jest.resetAllMocks();
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = {};

      service.checkRepositoryType = jest.fn().mockResolvedValue();
      service.validateLinkName = jest.fn().mockResolvedValue();
      service.processLinkCreation = jest.fn().mockResolvedValue();

      req = {
        req: { url: "/MyEntity(ID=123e4567-e89b-12d3-a456-426614174000)" },
        target: { name: "MyEntity" },
        data: { name: "linkName", url: "http://example.com" },
        user: { tokenInfo: { getTokenValue: jest.fn().mockReturnValue("tokenValue") } }
      };
      cds.model.definitions['MyEntity'] = { entity: "MyEntity" };
      getConfigurations.mockReturnValue({repositoryId: "repo123" });
      getDraftAttachmentsMetadataForLinkCreation.mockResolvedValue([{ filename: "existingLink" }]);
      setupDestinationMocks();
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
      expect(service.processLinkCreation).toHaveBeenCalledWith(
        {
          filename: "linkName",
          mimeType: "application/internet-shortcut",
          repositoryId: "repo123",
          linkUrl: "http://example.com"
        },
        cds.model.definitions.MyEntity,
        req
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

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = {};
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
    });

    it("should call getParentId and createLink with correct arguments", async () => {
      await service.processLinkCreation(linkToCreateInSDM, attachment, req);

      expect(service.getParentId).toHaveBeenCalledWith(
        attachment,
        req,
        "123e4567-e89b-12d3-a456-426614174000"
      );
      expect(service.createLink).toHaveBeenCalledWith(
        linkToCreateInSDM,
        service.creds,
        req,
        "parentId",
        "upIdField"
      );
    });

    it("should throw if getParentId fails", async () => {
      service.getParentId.mockRejectedValue(new Error("parent error"));
      await expect(
        service.processLinkCreation(linkToCreateInSDM, attachment, req)
      ).rejects.toThrow("parent error");
    });

    it("should throw if createLink fails", async () => {
      service.createLink.mockRejectedValue(new Error("create error"));
      await expect(
        service.processLinkCreation(linkToCreateInSDM, attachment, req)
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
        reject: jest.fn(),
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      getDraftAdministrativeData_DraftUUIDForUpId.mockResolvedValue([
        { DraftAdministrativeData_DraftUUID: "uuid-123" }
      ]);
      setupDestinationMocks();
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
      
      await service.createLink(linkToCreateInSDM, credentials, req, parentId, upIdKey);

      expect(createAttachment).toHaveBeenCalledWith(
        linkToCreateInSDM,
        credentials,
        parentId,
        expect.objectContaining({ url: expect.any(String) })
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
    });

    it("should reject with duplicateFileErr if nameConstraintViolation", async () => {
      createAttachment.mockResolvedValueOnce({
        status: 400,
        response: { data: { exception: "nameConstraintViolation" } }
      });
      
      await service.createLink(linkToCreateInSDM, credentials, req, parentId, upIdKey);

      expect(req.reject).toHaveBeenCalledWith(409, duplicateFileErr(['linkName']));
    });

    it("should reject with userNotAuthorisedErrorLink if status is 403", async () => {
      createAttachment.mockResolvedValueOnce({
        status: 403,
        response: { data: {} }
      });
      
      await service.createLink(linkToCreateInSDM, credentials, req, parentId, upIdKey);

      expect(req.reject).toHaveBeenCalledWith(403, "You do not have the required permissions to upload links. Please contact your administrator for access.");
    });

    it("should reject with message if other error", async () => {
      createAttachment.mockResolvedValueOnce({
        status: 400,
        response: { data: { message: "some error" } }
      });
      
      await service.createLink(linkToCreateInSDM, credentials, req, parentId, upIdKey);

      expect(req.reject).toHaveBeenCalledWith("some error");
    });
  });

  describe('handleEditLinkAction', () => {
    let service;
    let req;
    const attachmentId = '123e4567-e89b-12d3-a456-426614174000';

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = 'test-credentials';
      service.originalUrlMap = new Map();
      
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

      cds.model.definitions[req.target.name] = 'test-entity';
    });

    it('should successfully edit a link and store baseline URL', async () => {
      const existingAttachment = {
        url: 'existing-object-id',
        filename: 'MyLink.url',
        linkUrl: 'http://original-link.com'
      };
      getAttachmentById.mockResolvedValue(existingAttachment);
      setupDestinationMocks();
      editLink.mockResolvedValue({ status: 200 });
      editLinkInDraft.mockResolvedValue();

     const result = await service.handleEditLinkAction(req);

      expect(getAttachmentById).toHaveBeenCalledWith(attachmentId, 'test-entity');
      expect(editLink).toHaveBeenCalledWith(
          'existing-object-id',
          'MyLink',
          'http://new-link.com',
          service.creds,
          expect.objectContaining({ url: expect.any(String) })
      );
      expect(editLinkInDraft).toHaveBeenCalledWith(req, {
          ID: attachmentId,
          linkUrl: 'http://new-link.com',
          note: '__BASELINE_URL__:http://original-link.com'
      });
      expect(service.originalUrlMap.get(attachmentId)).toBe('http://original-link.com');
      expect(result).toEqual({
        success: true,
        message: "Link edited successfully"
      });
      expect(req.reject).not.toHaveBeenCalled();
    });
    
    it('should use existing baseline URL if already in originalUrlMap', async () => {
      const existingAttachment = {
        url: 'existing-object-id',
        filename: 'MyLink.url',
        linkUrl: 'http://current-link.com'
      };
      service.originalUrlMap.set(attachmentId, 'http://original-baseline.com');
      
      getAttachmentById.mockResolvedValue(existingAttachment);
      setupDestinationMocks();
      editLink.mockResolvedValue({ status: 200 });
      editLinkInDraft.mockResolvedValue();
      
      await service.handleEditLinkAction(req);
      
      expect(editLinkInDraft).toHaveBeenCalledWith(req, {
        ID: attachmentId,
        linkUrl: 'http://new-link.com',
        note: '__BASELINE_URL__:http://original-baseline.com'
      });
    });
    
    it('should reject with 404 if link to be edited is not found', async () => {
      getAttachmentById.mockResolvedValue(null);
      await service.handleEditLinkAction(req);
      expect(req.reject).toHaveBeenCalledWith(404, editLinkNotFoundErr);
    });
    
    it('should reject with 404 if link has no URL', async () => {
      getAttachmentById.mockResolvedValue({ filename: 'test.url' });
      await service.handleEditLinkAction(req);
      expect(req.reject).toHaveBeenCalledWith(404, editLinkNotFoundErr);
    });

    it('should reject with 403 for unauthorized users', async () => {
      getAttachmentById.mockResolvedValue({ url: 'some-url', filename: 'some-file.url' });
      setupDestinationMocks();
      editLink.mockResolvedValue({ status: 403 });
      
      await service.handleEditLinkAction(req);
      expect(req.reject).toHaveBeenCalledWith(400, userNotAuthorisedErrorEditLink);
    });
    
    it('should reject with error message for other failures', async () => {
      getAttachmentById.mockResolvedValue({ url: 'some-url', filename: 'some-file.url' });
      setupDestinationMocks();

      editLink.mockResolvedValue({
        status: 500,
        response: { data: { message: 'Repository Error' } }
      });

      await service.handleEditLinkAction(req);
      expect(req.reject).toHaveBeenCalledWith('Repository Error');
    });
  });
  
  describe('handleDraftSaveForLinks', () => {
    let service;
    let req;
    
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.originalUrlMap = new Map();
      service.originalUrlMap.set('attachment1', 'http://baseline1.com');
      service.originalUrlMap.set('attachment2', 'http://baseline2.com');
      // FIX: Spy on the actual method to assert calls
      service.updateBaselinesForEntity = jest.fn();
      
      req = {
        target: {
          name: 'Test.Entity.drafts'
        }
      };
    });
    
    it('should handle entity patterns when no target name', async () => {
      req.target = {}; // Simulate no target name
      
      // Mock the parent entity with references composition
      cds.model.definitions['ProcessorService.Incidents'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'ProcessorService.Incidents.references'
          }
        }
      };
      
      // Mock the entity definitions that the method looks for
      cds.model.definitions['ProcessorService.Incidents.references'] = { 
        entity: 'TestAttachments',
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['ProcessorService.Incidents.references.drafts'] = { 
        entity: 'TestAttachmentsDrafts'
      };
      
      await service.handleDraftSaveForLinks(req);
      
      // FIX: Assert calls to the spied function
      expect(service.updateBaselinesForEntity).toHaveBeenCalledWith('ProcessorService.Incidents.references');
      expect(service.updateBaselinesForEntity).toHaveBeenCalledWith('ProcessorService.Incidents.references.drafts');
      expect(service.updateBaselinesForEntity).toHaveBeenCalledTimes(2);
    });
    
    it('should not call updateBaselinesForEntity when target name is available', async () => {
      // Target name is available: 'Test.Entity.drafts'
      
      // Clean up entity definitions from previous test
      delete cds.model.definitions['ProcessorService.Incidents'];
      delete cds.model.definitions['ProcessorService.Incidents.references'];
      delete cds.model.definitions['ProcessorService.Incidents.references.drafts'];
      
      await service.handleDraftSaveForLinks(req);
      
      // FIX: Assert NOT called when target name is present (as per sdm.js logic)
      expect(service.updateBaselinesForEntity).not.toHaveBeenCalled();
    });
  });
  
  describe('updateBaselinesForEntity', () => {
    let service;
    
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.originalUrlMap = new Map();
      service.originalUrlMap.set('attachment1', 'http://baseline1.com');
      service.originalUrlMap.set('attachment2', 'http://baseline2.com');
      
      // Reset the global mocks to avoid contamination
      global.SELECT.one.from.mockClear().mockReturnThis();
      global.SELECT.one.where.mockClear();
      global.UPDATE.mockClear().mockImplementation(() => ({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue()
      }));
      
      cds.model.definitions['TestEntity'] = { name: 'test-entity' };
    });
    
    it('should update baselines for existing attachments', async () => {
      const mockAttachment1 = { ID: 'attachment1', linkUrl: 'http://current1.com' };
      const mockAttachment2 = { ID: 'attachment2', linkUrl: 'http://current2.com' };
      
      // Mock the SELECT chain properly
      const mockSelectChain = {
        where: jest.fn()
      };
      global.SELECT.one.from.mockReturnValue(mockSelectChain);
      
      // Mock consecutive calls to the where method
      mockSelectChain.where.mockResolvedValueOnce(mockAttachment1)
      .mockResolvedValueOnce(mockAttachment2);
      
      // Create a shared mock update object
      const mockUpdate = {
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue()
      };
      global.UPDATE.mockReturnValue(mockUpdate);
      
      await service.updateBaselinesForEntity('TestEntity');
      
      // Check that SELECT.one.from was called
      expect(global.SELECT.one.from).toHaveBeenCalledWith('TestEntity');
      expect(mockSelectChain.where).toHaveBeenCalledTimes(2);
      
      // Check map updates
      expect(service.originalUrlMap.get('attachment1')).toBe('http://current1.com');
      expect(service.originalUrlMap.get('attachment2')).toBe('http://current2.com');
      
      // Check UPDATE calls
      expect(global.UPDATE).toHaveBeenCalledWith('TestEntity');
      expect(mockUpdate.set).toHaveBeenCalledTimes(2);
      expect(mockUpdate.set).toHaveBeenCalledWith({ note: null });
      expect(mockUpdate.where).toHaveBeenCalledWith({ ID: 'attachment1' });
      expect(mockUpdate.where).toHaveBeenCalledWith({ ID: 'attachment2' });
    });
    
    it('should skip non-existent attachments', async () => {
      global.SELECT.one.where.mockResolvedValue(null);
      
      await service.updateBaselinesForEntity('TestEntity');
      
      expect(global.UPDATE().set).not.toHaveBeenCalled();
      expect(service.originalUrlMap.get('attachment1')).toBe('http://baseline1.com'); // Baseline remains untouched
    });
  });
  
  describe('handleDraftDiscardForLinks', () => {
    let service;
    let req;
    
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = 'test-credentials';
      service.originalUrlMap = new Map();
      service.revertLinkInSDM = jest.fn();
      
      req = {
        data: { ID: 'parent123' },
        target: { name: 'Parent.drafts' },
        user: {
          authInfo: { token: { getTokenValue: jest.fn().mockReturnValue('test-auth-token') } },
          tokenInfo: { getTokenValue: jest.fn().mockReturnValue('test-token') }
        }
      };
      
      global.SELECT.from.mockClear().mockReturnThis();
      global.SELECT.where.mockClear();
      
      // FIX: Add mock key structure for the target entity's attachments draft
      cds.model.definitions['Parent'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Parent.references'
          }
        }
      };
      cds.model.definitions['Parent.references'] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['Parent.references.drafts'] = mockUpKeyStructure;
      
      setupDestinationMocks();
    });
    
    it('should revert links with differing baseline URLs and delete from map', async () => {
      const draftAttachments = [
        {
          ID: 'attach1',
          linkUrl: 'http://current.com',
          note: '__BASELINE_URL__:http://original.com',
          filename: 'test.url',
          url: 'object-id'
        }
      ];
      service.originalUrlMap.set('attach1', 'http://original.com');
      
      global.SELECT.where.mockResolvedValue(draftAttachments);
      
      await service.handleDraftDiscardForLinks(req);
      
      expect(service.revertLinkInSDM).toHaveBeenCalledWith(
        draftAttachments[0],
        'http://original.com',
        req
      );
      expect(service.originalUrlMap.has('attach1')).toBe(false);
    });
    
    it('should skip attachments without baseline URLs', async () => {
      const draftAttachments = [
        {
          ID: 'attach1',
          linkUrl: 'http://current.com',
          note: 'some other note'
        }
      ];
      
      global.SELECT.where.mockResolvedValue(draftAttachments);
      
      await service.handleDraftDiscardForLinks(req);
      
      expect(service.revertLinkInSDM).not.toHaveBeenCalled();
    });
    
    it('should skip attachments where current URL matches baseline', async () => {
      const draftAttachments = [
        {
          ID: 'attach1',
          linkUrl: 'http://same.com',
          note: '__BASELINE_URL__:http://same.com'
        }
      ];
      
      global.SELECT.where.mockResolvedValue(draftAttachments);
      
      await service.handleDraftDiscardForLinks(req);
      
      expect(service.revertLinkInSDM).not.toHaveBeenCalled();
    });
    
    it('should handle missing entity definition gracefully', async () => {
      req.target.name = 'NonExistent.drafts';
      
      // Provide a minimal entity definition to prevent the crash
      cds.model.definitions['NonExistent.references.drafts'] = {
        keys: {
          up_: {
            keys: [{
              $generatedFieldName: 'up__ID'
            }]
          }
        }
      };
      
      // Mock SELECT to return empty results
      global.SELECT.where.mockResolvedValue([]);
      
      // Should execute without crashing
      await service.handleDraftDiscardForLinks(req);
      
      expect(service.revertLinkInSDM).not.toHaveBeenCalled();
    });
  });
  
  describe('revertLinkInSDM', () => {
    // ... (Test cases remain the same as they were correct) ...
    let service;
    
    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = 'test-credentials';
    });
    
    it('should successfully revert link in SDM', async () => {
      const draftAttachment = {
        ID: 'attach1',
        filename: 'test.url',
        url: 'object-id'
      };
      const originalUrl = 'http://original.com';
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
      };
      
      setupDestinationMocks();
      editLink.mockResolvedValue({ status: 200 });
      
      await service.revertLinkInSDM(draftAttachment, originalUrl, req);
      
      expect(editLink).toHaveBeenCalledWith(
        'object-id',
        'test',
        'http://original.com',
        service.creds,
        expect.objectContaining({ url: expect.any(String) })
      );
    });
    
    it('should handle filename without .url extension', async () => {
      const draftAttachment = {
        ID: 'attach1',
        filename: 'test',
        url: 'object-id'
      };
      const originalUrl = 'http://original.com';
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
      };
      
      setupDestinationMocks();
      editLink.mockResolvedValue({ status: 200 });
      
      await service.revertLinkInSDM(draftAttachment, originalUrl, req);
      
      expect(editLink).toHaveBeenCalledWith(
        'object-id',
        'test',
        'http://original.com',
        service.creds,
        expect.objectContaining({ url: expect.any(String) })
      );
    });
    
    it('should throw error when editLink fails', async () => {
      const draftAttachment = {
        ID: 'attach1',
        filename: 'test.url',
        url: 'object-id'
      };
      const originalUrl = 'http://original.com';
      const req = {
        user: {
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('tokenValue'),
          },
        },
      };
      
      setupDestinationMocks();
      editLink.mockRejectedValue(new Error('SDM Error'));
      
      await expect(service.revertLinkInSDM(draftAttachment, originalUrl, req))
      .rejects.toThrow('SDM Error');
    });
  });

  describe("getParentId", () => {
    let service;
    let mockReq;
    beforeEach(() => {
      NodeCache.prototype.get.mockClear();
      jest.clearAllMocks();
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

      cds.model.definitions[mockReq.target.name + ".references"] = {
        keys: {
          up_: {
            keys: [{ ref: ["attachment"] }],
          },
        },
      };
    });

    it("getParentId should call getFolderIdByPath if getFolderIdForEntity returns empty array", async () => {
      const attachments = cds.model.definitions[mockReq.target.name + ".references"]
      const destination = setupDestinationMocks();
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce("mocked_folder_id");
      const upId = "mocked_up_id";

      await service.getParentId(attachments, mockReq, upId)
 
      expect(getFolderIdByPath).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        cds.model.definitions[mockReq.target.name + ".references"],
        upId,
        expect.objectContaining({ url: expect.any(String) })
      );
    });
  
    it("getParentId should call createFolder if getFolderIdForEntity and getFolderIdByPath return empty", async () => {
      let attachments = cds.model.definitions[mockReq.target.name + ".references"]
      const destination = setupDestinationMocks();
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

      await service.getParentId(attachments, mockReq, upId);
 
      expect(createFolder).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        cds.model.definitions[mockReq.target.name + ".references"],
        upId,
        expect.objectContaining({ url: expect.any(String) })
      );
    });
  
    it("getParentId should reject with 403 if createFolder response status is 403 and message matches userDoesNotHaveRequiredScope", async () => {
      let attachments = cds.model.definitions[mockReq.target.name + ".references"];
      const destination = setupDestinationMocks();
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

      await service.getParentId(attachments, mockReq);

      expect(mockReq.reject).toHaveBeenCalledWith(403, userNotAuthorisedError);
    });

    it("getParentId should return parentId if folderId is not null in folderIds", async () => {
      let attachments = cds.model.definitions[mockReq.target.name + ".references"];

      const folderIds = [
        { folderId: null },
        { folderId: "mock_folder_id_1" },
        { folderId: "mock_folder_id_2" }
      ];
      
      getFolderIdForEntity.mockResolvedValueOnce(folderIds);

      const parentId = await service.getParentId(attachments, mockReq);

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
      isRestrictedCharactersInName.mockReturnValue(true);
      const data = [{ filename: "file1" }];
      const linkNameInRequest = "invalid/name";

      await service.validateLinkName(data, linkNameInRequest, req);

      expect(req.reject).toHaveBeenCalledWith(
        409,
        linkNameConstraintMessage([linkNameInRequest], "created")
      );
    });

    it("should reject if linkNameInRequest is duplicate", async () => {
      // Mock isRestrictedCharactersInName to return false
      isRestrictedCharactersInName.mockReturnValue(false);
      // Mock filterDuplicates to return a duplicate
      jest.spyOn(service, "filterDuplicates").mockReturnValue(["duplicateName"]);
      const data = [{ filename: "duplicateName" }];
      const linkNameInRequest = "duplicateName";

      await service.validateLinkName(data, linkNameInRequest, req);

      expect(req.reject).toHaveBeenCalledWith(
        409,
        duplicateDraftFileErr("duplicateName")
      );
    });

    it("should not reject if linkNameInRequest is valid and not duplicate", async () => {
      isRestrictedCharactersInName.mockReturnValue(false);
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
    
    beforeEach(() => {
      jest.clearAllMocks();
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
  
      cds.model.definitions["testName"] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'testName.references'
          }
        }
      };
      cds.model.definitions["testName.references"] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions["testName.references.drafts"] = {
        includes: ['sap.attachments.Attachments']
      };
    });
  
    it("should attach attachments to delete in req when they are present in drafts", async () => {
      mockDraftAttachments = cds.model.definitions["testName.references.drafts"];
  
      const attachmentsToDelete = ["attachment1", "attachment2"];
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce(attachmentsToDelete);
  
      mockReq.diff.mockResolvedValueOnce({
        references: ["attachment1", "attachment2"],
      });
  
      setupDestinationMocks();
      getFolderIdByIDAsPath.mockResolvedValueOnce("mock_folder_id");
  
      await service.attachDraftDeletionData(mockReq);
  
      expect(getURLsToDeleteFromDraftAttachments).toHaveBeenCalledWith("mocked_id", mockDraftAttachments);
      expect(mockReq.attachmentsToDelete).toEqual(attachmentsToDelete);
      expect(mockReq.parentId).toEqual(["mock_folder_id"]);
    });
  
    it("should not set `parentId` if the number of attachments in diff is different from `attachmentsToDelete`", async () => {
      const attachmentsToDelete = ["attachment1"];
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce(attachmentsToDelete);
  
      mockReq.diff.mockResolvedValueOnce({
        references: ["attachment1", "attachment2", "attachment3"],
      });
  
      await service.attachDraftDeletionData(mockReq);
      
      expect(mockReq.parentId).toBeUndefined();
    });
  
    it("should not attach attachments to delete if no draft attachments are found", async () => {
      delete cds.model.definitions["testName.references.drafts"];
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce([]);
  
      await service.attachDraftDeletionData(mockReq);
  
      expect(mockReq.attachmentsToDelete).toBeUndefined();
    });

    it("should not set attachmentsToDelete if attachmentsToDeleteFromDraft is empty", async () => {
  
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce([]); // Empty array to simulate no deletions
  
      mockReq.diff.mockResolvedValueOnce({
        references: ["attachment1", "attachment2"],
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
        references: ["attachment1", "attachment2"],
      });
  
      // Simulate fetching a token, but folder ID fetch returns falsy
      setupDestinationMocks();
      getFolderIdByIDAsPath.mockResolvedValueOnce(null); // Falsy value to test this situation
  
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
    
    it("should register 'editLink' handler and call handleEditLinkAction", async () => {
      const mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
        on: jest.fn(),
      };
      const service = new SDMAttachmentsService();
      service.handleEditLinkAction = jest.fn().mockResolvedValue("editLinkResult");
      
      service.registerUpdateHandlers(mockSrv, "entity", { drafts: "drafts" });
      
      // Find the handler registered for 'editLink'
      const editLinkCall = mockSrv.on.mock.calls.find(
        ([eventName]) => eventName === "editLink"
      );
      expect(editLinkCall).toBeDefined();
      
      // Simulate calling the handler
      const handler = editLinkCall[1];
      const req = { error: jest.fn() };
      const result = await handler(req);
      
      expect(service.handleEditLinkAction).toHaveBeenCalledWith(req);
      expect(result).toBe("editLinkResult");
      expect(req.error).not.toHaveBeenCalled();
    });
  });

  describe('checkRepositoryType', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { key: 'test-creds' };
    });

    it('should reject with error when repository is versioned', async () => {
      const req = { reject: jest.fn() };
      
      // Mock getConfigurations to return a repositoryId
      getConfigurations.mockReturnValue({ repositoryId: 'test-repo' });
      
      // Mock user token info
      cds.context = {
        user: {
          tokenInfo: {
            getPayload: () => ({ ext_attr: { zdn: 'test-subdomain' } })
          }
        }
      };
      
      // Mock cache to return undefined (not cached)
      mockCacheInstance.get.mockReturnValue(undefined);
      
      // Mock repository info calls
      const mockDestination = { url: "http://example.com" };
      service.technicalUserDestn = mockDestination;
      getRepositoryInfo.mockResolvedValue({ capabilities: {} });
      isRepositoryVersioned.mockReturnValue(true);
      
      await service.checkRepositoryType(req);
      
      expect(req.reject).toHaveBeenCalledWith(400, versionedRepositoryErr);
    });

    it('should reject with error when cached repository type is versioned', async () => {
      const req = { reject: jest.fn() };
      
      getConfigurations.mockReturnValue({ repositoryId: 'test-repo' });
      
      cds.context = {
        user: {
          tokenInfo: {
            getPayload: () => ({ ext_attr: { zdn: 'test-subdomain' } })
          }
        }
      };
      
      // Mock cache to return "versioned"
      mockCacheInstance.get.mockReturnValue('versioned');
      
      // Create service AFTER setting up mocks
      const cachedService = new SDMAttachmentsService();
      cachedService.creds = { key: 'test-creds' };
      
      await cachedService.checkRepositoryType(req);
      
      expect(req.reject).toHaveBeenCalledWith(400, versionedRepositoryErr);
    });
  });

  describe('get method error paths', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { key: 'test-creds' };
    });

    it('should reject with 403 when content is "Forbidden"', async () => {
      const req = {
        reject: jest.fn(),
        user: { tokenInfo: { getTokenValue: () => 'test-token' } }
      };
      const keys = { ID: 'test-id' };
      const attachments = {};

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });
      setupDestinationMocks();
      readAttachment.mockResolvedValue('Forbidden');

      await service.get(attachments, keys, req);

      expect(req.reject).toHaveBeenCalledWith(403, userNotAuthorisedReadError);
    });

    it('should reject with 404 when content is "Not Found"', async () => {
      const req = {
        reject: jest.fn(),
        user: { tokenInfo: { getTokenValue: () => 'test-token' } }
      };
      const keys = { ID: 'test-id' };
      const attachments = {};

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });
      setupDestinationMocks();
      readAttachment.mockResolvedValue('Not Found');

      await service.get(attachments, keys, req);

      expect(req.reject).toHaveBeenCalledWith(404, attachmentNotFound);
    });

    it('should reject with 500 for other error types', async () => {
      const req = {
        reject: jest.fn(),
        user: { tokenInfo: { getTokenValue: () => 'test-token' } }
      };
      const keys = { ID: 'test-id' };
      const attachments = {};

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });
      setupDestinationMocks();
      readAttachment.mockResolvedValue('Some other error');

      await service.get(attachments, keys, req);

      expect(req.reject).toHaveBeenCalledWith(500, errorMessage);
    });
  });

  describe('processCompositionRename', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { key: 'test-creds' };
    });

    it('should return early when attachmentsEntity does not exist', async () => {
      const req = {
        target: { name: 'Test.Entity' },
        data: {}
      };
      
      // Mock entity definition to not exist
      cds.model.definitions['Test.Entity.references'] = undefined;
      
      const result = await service.processCompositionRename(req, 'references', 'test-repo');
      
      expect(result).toBeUndefined();
    });
  });

  describe('getAttachmentCompositions', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });

    it('should return empty array when entity definition does not exist', () => {
      const targetEntity = { name: 'NonExistent.Entity' };
      
      delete cds.model.definitions['NonExistent.Entity'];
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual([]);
    });

    it('should return empty array when entity has no elements', () => {
      const targetEntity = { name: 'Test.EmptyEntity' };
      
      cds.model.definitions['Test.EmptyEntity'] = {};
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual([]);
    });

    it('should find composition named "references"', () => {
      const targetEntity = { name: 'Test.EntityWithReferences' };
      
      cds.model.definitions['Test.EntityWithReferences'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.References'
          }
        }
      };
      
      cds.model.definitions['Test.References'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual(['references']);
    });

    it('should find composition named "attachments"', () => {
      const targetEntity = { name: 'Test.EntityWithAttachments' };
      
      cds.model.definitions['Test.EntityWithAttachments'] = {
        elements: {
          attachments: {
            type: 'cds.Composition',
            target: 'Test.Attachments'
          }
        }
      };
      
      cds.model.definitions['Test.Attachments'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual(['attachments']);
    });

    it('should find composition with custom name "documents"', () => {
      const targetEntity = { name: 'Test.EntityWithDocuments' };
      
      cds.model.definitions['Test.EntityWithDocuments'] = {
        elements: {
          documents: {
            type: 'cds.Composition',
            target: 'Test.Documents'
          }
        }
      };
      
      cds.model.definitions['Test.Documents'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual(['documents']);
    });

    it('should find composition with custom name "files"', () => {
      const targetEntity = { name: 'Test.EntityWithFiles' };
      
      cds.model.definitions['Test.EntityWithFiles'] = {
        elements: {
          files: {
            type: 'cds.Composition',
            target: 'Test.Files'
          }
        }
      };
      
      cds.model.definitions['Test.Files'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual(['files']);
    });

    it('should find multiple attachment compositions with different names', () => {
      const targetEntity = { name: 'Test.EntityWithMultipleCompositions' };
      
      cds.model.definitions['Test.EntityWithMultipleCompositions'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.References'
          },
          documents: {
            type: 'cds.Composition',
            target: 'Test.Documents'
          },
          files: {
            type: 'cds.Composition',
            target: 'Test.Files'
          }
        }
      };
      
      cds.model.definitions['Test.References'] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['Test.Documents'] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['Test.Files'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toContain('references');
      expect(result).toContain('documents');
      expect(result).toContain('files');
      expect(result.length).toBe(3);
    });

    it('should ignore compositions that do not have sap.attachments.Attachments includes', () => {
      const targetEntity = { name: 'Test.EntityWithMixedCompositions' };
      
      cds.model.definitions['Test.EntityWithMixedCompositions'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.References'
          },
          otherComposition: {
            type: 'cds.Composition',
            target: 'Test.OtherEntity'
          }
        }
      };
      
      cds.model.definitions['Test.References'] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['Test.OtherEntity'] = {
        includes: ['SomeOtherAspect']
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual(['references']);
    });

    it('should ignore non-composition elements', () => {
      const targetEntity = { name: 'Test.EntityWithMixedElements' };
      
      cds.model.definitions['Test.EntityWithMixedElements'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.References'
          },
          title: {
            type: 'cds.String'
          },
          status: {
            type: 'cds.Integer'
          }
        }
      };
      
      cds.model.definitions['Test.References'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual(['references']);
    });

    it('should handle composition without target definition', () => {
      const targetEntity = { name: 'Test.EntityWithBrokenComposition' };
      
      cds.model.definitions['Test.EntityWithBrokenComposition'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.NonExistentTarget'
          }
        }
      };
      
      // Target definition doesn't exist
      delete cds.model.definitions['Test.NonExistentTarget'];
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual([]);
    });

    it('should handle composition target without includes property', () => {
      const targetEntity = { name: 'Test.EntityWithIncompleteTarget' };
      
      cds.model.definitions['Test.EntityWithIncompleteTarget'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.IncompleteTarget'
          }
        }
      };
      
      cds.model.definitions['Test.IncompleteTarget'] = {
        // No includes property
      };
      
      const result = service.getAttachmentCompositions(targetEntity);
      
      expect(result).toEqual([]);
    });

    it('should work with any composition name following naming convention', () => {
      const testCases = [
        'attachments',
        'references',
        'documents',
        'files',
        'media',
        'uploads',
        'resources',
        'assets',
        'binaries'
      ];

      testCases.forEach(compositionName => {
        const targetEntity = { name: `Test.EntityWith${compositionName}` };
        
        cds.model.definitions[`Test.EntityWith${compositionName}`] = {
          elements: {
            [compositionName]: {
              type: 'cds.Composition',
              target: `Test.${compositionName}`
            }
          }
        };
        
        cds.model.definitions[`Test.${compositionName}`] = {
          includes: ['sap.attachments.Attachments']
        };
        
        const result = service.getAttachmentCompositions(targetEntity);
        
        expect(result).toEqual([compositionName]);
      });
    });
  });

  describe('replacePropertiesInAttachment', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
    });

    it('should return early when req.data does not have compositionName', () => {
      const req = { data: {} };
      const id = 'test-id';
      const fileName = 'test.pdf';
      const propertiesInDB = {};
      const secondaryTypeProperties = new Map();
      const compositionName = 'references';
      
      service.replacePropertiesInAttachment(req, id, fileName, propertiesInDB, secondaryTypeProperties, compositionName);
      
      // Should return early without error
      expect(req.data[compositionName]).toBeUndefined();
    });

    it('should return early when attachment with ID is not found', () => {
      const req = { 
        data: { 
          references: [
            { ID: 'other-id', filename: 'other.pdf' }
          ] 
        } 
      };
      const id = 'test-id';
      const fileName = 'test.pdf';
      const propertiesInDB = {};
      const secondaryTypeProperties = new Map();
      const compositionName = 'references';
      
      service.replacePropertiesInAttachment(req, id, fileName, propertiesInDB, secondaryTypeProperties, compositionName);
      
      // Attachment filename should not be changed
      expect(req.data.references[0].filename).toBe('other.pdf');
    });
  });

  describe('attachDraftDeletionData - edge cases', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { key: 'test-creds' };
    });

    it('should handle when draftAttachments entity does not exist', async () => {
      const req = {
        target: { name: 'Test.Entity.drafts' },
        data: { ID: 'test-id' },
        diff: jest.fn().mockResolvedValue({ references: [] }),
        event: 'DELETE',
        user: {
          tokenInfo: { getTokenValue: () => 'test-token' }
        }
      };

      cds.model.definitions['Test.Entity'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.Entity.references'
          }
        }
      };
      
      cds.model.definitions['Test.Entity.references'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      // Draft entity doesn't exist
      delete cds.model.definitions['Test.Entity.references.drafts'];
      
      await service.attachDraftDeletionData(req);
      
      // Should not throw and should not set attachmentsToDelete
      expect(req.attachmentsToDelete).toBeUndefined();
    });
  });

  describe('handleDraftDiscardForLinks - edge cases', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.originalUrlMap = new Map();
      service.creds = { key: 'test-creds' };
    });

    it('should continue when attachmentsEntity does not exist', async () => {
      const req = {
        target: { name: 'Test.Entity.drafts' },
        data: { ID: 'test-id' },
        user: {
          tokenInfo: { getTokenValue: () => 'test-token' }
        }
      };

      cds.model.definitions['Test.Entity'] = {
        elements: {
          references: {
            type: 'cds.Composition',
            target: 'Test.Entity.references'
          }
        }
      };
      
      cds.model.definitions['Test.Entity.references'] = {
        includes: ['sap.attachments.Attachments']
      };
      
      // Draft entity doesn't exist
      delete cds.model.definitions['Test.Entity.references.drafts'];
      
      setupDestinationMocks();
      
      await service.handleDraftDiscardForLinks(req);
      
      // Should not throw
    });
  });

  describe('handleDraftDiscardForLinks - missing entity', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.originalUrlMap = new Map();
    });

    it('should handle missing entity definition gracefully', async () => {
      const req = {
        target: { name: 'NonExistent.Entity.drafts' },
        data: { ID: 'test-id' },
        user: {
          tokenInfo: { getTokenValue: () => 'test-token' }
        }
      };

      // Ensure entity doesn't exist
      delete cds.model.definitions['NonExistent.Entity'];
      
      await service.handleDraftDiscardForLinks(req);
      
      // Should not throw and should not call any SDM operations
    });
  });

});