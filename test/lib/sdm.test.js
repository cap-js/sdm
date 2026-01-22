const SDMAttachmentsService = require("../../lib/sdm");
const NodeCache = require("node-cache");
const { getDestinationFromServiceBinding, retrieveJwt } = require("@sap-cloud-sdk/connectivity");
const {
  getConfigurations,
  isRepositoryVersioned,
  getSdmInstanceName
} = require("../../lib/util");
const {
  getDraftAttachments,
  getURLFromAttachments
} = require("../../lib/persistence");
const {
  readAttachment,
  getRepositoryInfo
} = require("../../lib/handler");
let {
  versionedRepositoryErr
} = require("../../lib/util/messageConsts");

let {
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties
} = require("../../lib/util");

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
        authInfo: {

          token: {
          getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
          }

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
          authInfo: {

            token: {
            getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
            }

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
          authInfo: {
            token: {
              getPayload: jest.fn().mockReturnValue({ ext_attr: { zdn: "test-subdomain" } })
            }
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
          authInfo: {

            token: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
            }

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
          authInfo: {

            token: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
            }

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
          authInfo: {

            token: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
            }

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
          authInfo: {

            token: {
            getTokenValue: jest.fn().mockReturnValue('sampleTokenValue')
            }

          }
        },
        warn: jest.fn()
      };
      
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
    });
  });

  describe("getAttachmentCompositions", () => {
    let service;

    beforeEach(() => {
      service = new SDMAttachmentsService();
      cds.model.definitions = {
        "Test.Entity": {
          elements: {
            attachments: {
              type: "cds.Composition",
              target: "Test.Attachments"
            },
            unrelated: {
              type: "cds.String"
            }
          }
        },
        "Test.Attachments": {
          includes: ["sap.attachments.Attachments"]
        }
      };
    });

    it("should return attachment compositions for a valid entity", () => {
      const targetEntity = { name: "Test.Entity" };
      const result = service.getAttachmentCompositions(targetEntity);
      expect(result).toEqual(["attachments"]);
    });

    it("should return an empty array if no attachment compositions are found", () => {
      const targetEntity = { name: "NonExistent.Entity" };
      const result = service.getAttachmentCompositions(targetEntity);
      expect(result).toEqual([]);
    });

    it("should return an empty array if the entity has no elements", () => {
      cds.model.definitions["Test.Entity"].elements = {};
      const targetEntity = { name: "Test.Entity" };
      const result = service.getAttachmentCompositions(targetEntity);
      expect(result).toEqual([]);
    });
  });

  describe("renameHandler", () => {
    let service;
    let req;

    beforeEach(() => {
      service = new SDMAttachmentsService();
      req = {
        target: { name: "Test.Entity" },
        warn: jest.fn()
      };
      cds.model.definitions = {
        "Test.Entity": {
          elements: {
            attachments: {
              type: "cds.Composition",
              target: "Test.Attachments"
            }
          }
        },
        "Test.Attachments": {
          includes: ["sap.attachments.Attachments"]
        }
      };
      service.processCompositionRename = jest.fn();
    });

    it("should process all attachment compositions", async () => {
      await service.renameHandler(req);
      expect(service.processCompositionRename).toHaveBeenCalledWith(req, "attachments", "repo123");
    });

    it("should not process if no attachment compositions are found", async () => {
      cds.model.definitions["Test.Entity"].elements = {};
      await service.renameHandler(req);
      expect(service.processCompositionRename).not.toHaveBeenCalled();
    });
  });
});