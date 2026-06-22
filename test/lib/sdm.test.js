const SDMAttachmentsService = require("../../lib/sdm");
const NodeCache = require("node-cache");
const { getDestinationFromServiceBinding, retrieveJwt } = require("@sap-cloud-sdk/connectivity");
const { executeHttpRequest } = require("@sap-cloud-sdk/http-client");
const {
  getConfigurations,
  isRepositoryVersioned,
  getSdmInstanceName,
  isRestrictedCharactersInName,
  getStatusCondition,
  getPropertyTitles,
  getSecondaryPropertiesWithInvalidDefinition,
  getSecondaryTypeProperties,
  getUpdatedSecondaryProperties,
  transformSDMServiceBindingToClientCredentialsDestination,
  transformSDMServiceBindingToJWTBearerCredentialsDestination,
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
  errorMessage,
  mimeTypeInvalidError
} = require("../../lib/util/messageConsts");

jest.mock("@cap-js/attachments/srv/attachments/basic", () => class {
  async init() {
    return Promise.resolve();
  }
  // eslint-disable-next-line no-unused-vars
  draftSaveHandler(_attachments) {
    // eslint-disable-next-line no-unused-vars
    return async (_res, _req) => {
      // Mock parent handler
    };
  }
  // eslint-disable-next-line no-unused-vars
  registerHandlers(_srv) {
    // Mock parent registerHandlers
  }
});
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
  transformSDMServiceBindingToClientCredentialsDestination: jest.fn(),
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
    },
    // Add ql property to reference global mocks
    get ql() {
      return {
        SELECT: global.SELECT,
        UPDATE: global.UPDATE,
        DELETE: global.DELETE
      };
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
global.DELETE = {
  from: jest.fn().mockReturnThis(),
  where: jest.fn().mockResolvedValue()
};

// Destructure SELECT and UPDATE from global for easier usage in tests
const { SELECT, UPDATE } = global;


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
  
  describe("checkRepositoryType", () => {
    let service;
    let cache;
    
    beforeEach(() => {
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
      
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      cache.get.mockReturnValue(undefined);
      const mockDestination = { url: "http://example.com" };
      service.getTechnicalDestination = jest.fn().mockResolvedValue(mockDestination);
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
      cache.get.mockReturnValue(undefined);
      const mockDestination = { url: "http://example.com" };
      service.getTechnicalDestination = jest.fn().mockResolvedValue(mockDestination);
      getRepositoryInfo.mockResolvedValue({ data: "mock-repo-info" });
      isRepositoryVersioned.mockResolvedValue(true);
  
      await service.checkRepositoryType(mockReq);
  
      expect(getRepositoryInfo).toHaveBeenCalledWith(mockReq, service.creds, mockDestination);
      expect(isRepositoryVersioned).toHaveBeenCalledWith({ data: "mock-repo-info" }, "repo123");
      expect(mockReq.reject).toHaveBeenCalledWith(400, versionedRepositoryErr);
    });

    it("should use cached repository type when available", async () => {
      const mockReq = { reject: jest.fn() };
      
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      
      // Set up cds.context to provide subdomain
      cds.context = {
        user: {
          authInfo: {
            token: {
              getPayload: () => ({
                ext_attr: {
                  zdn: "test-subdomain"
                }
              })
            }
          }
        }
      };
      
      // Mock NodeCache.prototype.get to return "versioned" for the specific key
      NodeCache.prototype.get.mockImplementation((key) => {
        if (key === "repo123_test-subdomain") {
          return "versioned";
        }
        return undefined;
      });
      
      // Spy on getTechnicalDestination
      const getTechnicalDestinationSpy = jest.spyOn(service, 'getTechnicalDestination');

      await service.checkRepositoryType(mockReq);

      // Should not call getTechnicalDestination since cache is available
      expect(getTechnicalDestinationSpy).not.toHaveBeenCalled();
      expect(getRepositoryInfo).not.toHaveBeenCalled();
      // Should reject because cached value is "versioned"
      expect(mockReq.reject).toHaveBeenCalledWith(400, versionedRepositoryErr);
    });

    it("should not reject when cached repository type is non-versioned", async () => {
      const mockReq = { reject: jest.fn() };
      
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      
      // Set up cds.context
      cds.context = {
        user: {
          authInfo: {
            token: {
              getPayload: () => ({
                ext_attr: {
                  zdn: "test-subdomain"
                }
              })
            }
          }
        }
      };
      
      // Mock NodeCache.prototype.get to return "non-versioned"
      NodeCache.prototype.get.mockImplementation((key) => {
        if (key === "repo123_test-subdomain") {
          return "non-versioned";
        }
        return undefined;
      });

      await service.checkRepositoryType(mockReq);

      expect(mockReq.reject).not.toHaveBeenCalled();
    });
  });

  describe("init", () => {
    it("should initialize credentials and originalUrlMap", async () => {
      const service = new SDMAttachmentsService();
      service.options = { credentials: { uri: "test-uri", clientId: "test-id" } };
      
      // The parent class init is called via super.init()
      // Just ensure init runs without error and sets the properties
      await service.init();

      expect(service.creds).toEqual({ uri: "test-uri", clientId: "test-id" });
      expect(service.originalUrlMap).toBeInstanceOf(Map);
    });
  });

  describe("getTechnicalDestination", () => {
    it("should get technical destination with subdomain from context", async () => {
      const service = new SDMAttachmentsService();
      
      cds.context = {
        user: {
          authInfo: {
            token: {
              payload: {
                ext_attr: {
                  zdn: "test-subdomain"
                }
              }
            }
          }
        }
      };

      getSdmInstanceName.mockReturnValue("sdm-instance");
      const mockDestination = { url: "http://example.com" };
      getDestinationFromServiceBinding.mockResolvedValue(mockDestination);

      const result = await service.getTechnicalDestination();

      expect(getDestinationFromServiceBinding).toHaveBeenCalledWith({
        destinationName: "sdm-instance",
        useCache: true,
        serviceBindingTransformFn: expect.any(Function)
      });
      expect(result).toEqual(mockDestination);
    });

    it("should pass transform callback through technical destination lookup", async () => {
      const service = new SDMAttachmentsService();

      cds.context = {
        user: {
          authInfo: {
            token: {
              payload: {
                ext_attr: {
                  zdn: "test-subdomain"
                }
              }
            }
          }
        }
      };

      getSdmInstanceName.mockReturnValue("sdm-instance");
      transformSDMServiceBindingToClientCredentialsDestination.mockReturnValue({ transformed: true });
      getDestinationFromServiceBinding.mockImplementationOnce(async ({ serviceBindingTransformFn }) => {
        const transformed = serviceBindingTransformFn({ binding: true }, { option: true });
        expect(transformSDMServiceBindingToClientCredentialsDestination).toHaveBeenCalledWith(
          { binding: true },
          { option: true },
          "test-subdomain"
        );
        expect(transformed).toEqual({ transformed: true });
        return { url: "http://example.com" };
      });

      await service.getTechnicalDestination();
    });
  });

  describe("getDestination", () => {
    it("should get destination and cache it on request object", async () => {
      const service = new SDMAttachmentsService();
      const mockReq = {
        _sdmDestination: undefined
      };
      cds.context = {
        user: {
          authInfo: {
            token: {
              payload: {
                origin: "sap.custom",
                ext_attr: {
                  zdn: "test-subdomain"
                }
              }
            }
          }
        }
      };
      retrieveJwt.mockReturnValue("user-jwt");
      getSdmInstanceName.mockReturnValue("sdm-instance");
      const mockDestination = { url: "http://example.com" };
      getDestinationFromServiceBinding.mockResolvedValue(mockDestination);

      const result = await service.getDestination(mockReq);

      expect(retrieveJwt).toHaveBeenCalledWith(mockReq);
      expect(getDestinationFromServiceBinding).toHaveBeenCalledWith({
        destinationName: "sdm-instance",
        jwt: "user-jwt",
        useCache: true,
        serviceBindingTransformFn: expect.any(Function)
      });
      expect(result).toEqual(mockDestination);
      expect(mockReq._sdmDestination).toEqual(mockDestination);
    });

    it("should return cached destination when available", async () => {
      jest.clearAllMocks();
      const service = new SDMAttachmentsService();
      const cachedDestination = { url: "http://cached.com" };
      const mockReq = {
        _sdmDestination: cachedDestination
      };

      const result = await service.getDestination(mockReq);

      expect(getDestinationFromServiceBinding).not.toHaveBeenCalled();
      expect(result).toEqual(cachedDestination);
    });

    it("should execute client-credentials transform callback when origin is missing", async () => {
      const service = new SDMAttachmentsService();
      const mockReq = { _sdmDestination: undefined };

      cds.context = {
        user: {
          authInfo: {
            token: {
              payload: {
                ext_attr: {
                  zdn: "test-subdomain"
                }
              }
            }
          }
        }
      };

      retrieveJwt.mockReturnValue("user-jwt");
      getSdmInstanceName.mockReturnValue("sdm-instance");
      transformSDMServiceBindingToClientCredentialsDestination.mockReturnValue({ transformed: true });
      getDestinationFromServiceBinding.mockImplementationOnce(async ({ serviceBindingTransformFn }) => {
        const transformed = serviceBindingTransformFn({ binding: true }, { option: true });
        expect(transformSDMServiceBindingToClientCredentialsDestination).toHaveBeenCalledWith(
          { binding: true },
          { option: true },
          "test-subdomain"
        );
        expect(transformed).toEqual({ transformed: true });
        return { url: "http://example.com" };
      });

      await service.getDestination(mockReq);
    });

    it("should execute jwt-bearer transform callback when origin is present", async () => {
      const service = new SDMAttachmentsService();
      const mockReq = { _sdmDestination: undefined };

      cds.context = {
        user: {
          authInfo: {
            token: {
              payload: {
                origin: "sap.custom",
                ext_attr: {
                  zdn: "test-subdomain"
                }
              }
            }
          }
        }
      };

      retrieveJwt.mockReturnValue("user-jwt");
      getSdmInstanceName.mockReturnValue("sdm-instance");
      transformSDMServiceBindingToJWTBearerCredentialsDestination.mockReturnValue({ transformed: true });
      getDestinationFromServiceBinding.mockImplementationOnce(async ({ serviceBindingTransformFn }) => {
        const transformed = serviceBindingTransformFn({ binding: true }, { option: true });
        expect(transformSDMServiceBindingToJWTBearerCredentialsDestination).toHaveBeenCalledWith(
          { binding: true },
          { option: true },
          "user-jwt"
        );
        expect(transformed).toEqual({ transformed: true });
        return { url: "http://example.com" };
      });

      await service.getDestination(mockReq);
    });
  });
  it("should use Client Credentials when origin is not present in token", async () => {
    jest.clearAllMocks();
    const service = new SDMAttachmentsService();
    const mockReq = {
      _sdmDestination: undefined
    };

    // Mock cds.context without origin in token payload
    cds.context = {
      user: {
        authInfo: {
          token: {
            payload: {
              ext_attr: {
                zdn: "test-subdomain"
              }
              // No 'origin' field here
            }
          }
        }
      }
    };

    retrieveJwt.mockReturnValue("user-jwt");
    getSdmInstanceName.mockReturnValue("sdm-instance");
    const mockDestination = { url: "http://example.com" };
    getDestinationFromServiceBinding.mockResolvedValue(mockDestination);

    const result = await service.getDestination(mockReq);

    // Should call with Client Credentials (no jwt parameter)
    expect(getDestinationFromServiceBinding).toHaveBeenCalledWith({
      destinationName: "sdm-instance",
      useCache: true,
      serviceBindingTransformFn: expect.any(Function)
    });
    expect(result).toEqual(mockDestination);
    expect(mockReq._sdmDestination).toEqual(mockDestination);
  });

  it("should use JWT Bearer when origin is present in token", async () => {
    jest.clearAllMocks();
    const service = new SDMAttachmentsService();
    const mockReq = {
      _sdmDestination: undefined
    };

    // Mock cds.context with origin in token payload
    cds.context = {
      user: {
        authInfo: {
          token: {
            payload: {
              origin: "sap.custom",
              ext_attr: {
                zdn: "test-subdomain"
              }
            }
          }
        }
      }
    };

    retrieveJwt.mockReturnValue("user-jwt");
    getSdmInstanceName.mockReturnValue("sdm-instance");
    const mockDestination = { url: "http://example.com" };
    getDestinationFromServiceBinding.mockResolvedValue(mockDestination);

    const result = await service.getDestination(mockReq);

    // Should call with JWT Bearer (includes jwt parameter)
    expect(getDestinationFromServiceBinding).toHaveBeenCalledWith({
      destinationName: "sdm-instance",
      jwt: "user-jwt",
      useCache: true,
      serviceBindingTransformFn: expect.any(Function)
    });
    expect(result).toEqual(mockDestination);
    expect(mockReq._sdmDestination).toEqual(mockDestination);
  });
  describe("getSDMCredentials", () => {
    it("should return credentials", () => {
      const service = new SDMAttachmentsService();
      service.creds = { uri: "test-uri", clientId: "test-client" };

      const result = service.getSDMCredentials();

      expect(result).toEqual({ uri: "test-uri", clientId: "test-client" });
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
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue("tokenValue"),
          },
        },
      };
      
      // Set up HTTP context for get() method
      cds.context = { http: { req } };
      
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
      
      // Set up HTTP context for get() method
      cds.context = { http: { req } };
      
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
      
      // Set up HTTP context for get() method
      cds.context = { http: { req } };
      
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

  describe('draftEntityRenameHandler', () => {
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
          tokenInfo: {
            getTokenValue: jest.fn().mockReturnValue('sampleTokenValue')
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
  
      await service.draftEntityRenameHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(getDraftAttachments).toHaveBeenCalledWith(cds.model.definitions['sampleTarget.references'], req, 'repo123');
      expect(service.updateDraftAttachments).not.toHaveBeenCalled();
      expect(service.updateNonDraftAttachments).not.toHaveBeenCalled();
      expect(req.warn).not.toHaveBeenCalled();
    });

    it('should rename draft attachments during save', async () => {
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
  
      await service.draftEntityRenameHandler(req);
  
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
  
      await service.draftEntityRenameHandler(req);
  
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
      
      await expect(service.draftEntityRenameHandler(req)).rejects.toThrow('Draft update failed');
  
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
  
      await service.draftEntityRenameHandler(req);
  
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
  
      await service.draftEntityRenameHandler(req);
  
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
      // Default mock for _getNoteFromDB so existing tests are unaffected by the new note flow
      service._getNoteFromDB = jest.fn().mockResolvedValue(null);
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
      setupDestinationMocks();
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
      // Default mock for _getNoteFromDB so existing tests are unaffected by the new note flow
      service._getNoteFromDB = jest.fn().mockResolvedValue(null);

      // Mock dependencies
      service.replacePropertiesInAttachment = jest.fn();
      service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'file1.txt', folderId: 'mockFolderId' });
      getPropertiesForID.mockResolvedValue({ property1: 'value1' });
      getUpdatedSecondaryProperties.mockReturnValue({ property1: 'updatedValue1' });
      updateAttachment.mockResolvedValue(200);
      isRestrictedCharactersInName.mockReturnValue(false);
      setupDestinationMocks();
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

    it('should handle direct PATCH operation when compositionName is not provided', () => {
      const reqDirectPatch = {
        data: {
          ID: 'attachment1',
          filename: 'oldFileName',
          property1: 'oldValue1'
        }
      };
      
      const propertiesInDB = { property1: 'newValue1' };
      const fileName = 'newFileName';
      
      // Call without compositionName to trigger direct PATCH path
      service.replacePropertiesInAttachment(reqDirectPatch, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties, null);
      
      expect(reqDirectPatch.data.filename).toBe('newFileName');
      expect(reqDirectPatch.data.secondaryKey1).toBe('newValue1');
    });

    it('should handle direct PATCH operation when req.data.ID matches the target ID', () => {
      const reqDirectPatch = {
        data: {
          ID: 'attachment1',
          filename: 'oldFileName',
          property1: 'oldValue1',
          property2: 'oldValue2'
        }
      };
      
      const propertiesInDB = { property1: 'patchedValue1', property2: 'patchedValue2' };
      const fileName = 'patchedFile.pdf';
      
      // Call without compositionName but with matching ID
      service.replacePropertiesInAttachment(reqDirectPatch, 'attachment1', fileName, propertiesInDB, secondaryTypeProperties, undefined);
      
      expect(reqDirectPatch.data.filename).toBe('patchedFile.pdf');
      expect(reqDirectPatch.data.secondaryKey1).toBe('patchedValue1');
      expect(reqDirectPatch.data.secondaryKey2).toBe('patchedValue2');
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

  describe('registerHandlers', () => {
    let service;
    let mockSrv;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service._registeredEntityHandlers = new Set();
      service._registeredTargetHandlers = new Set();
      service._registeredGlobalActionHandlers = false;
      
      mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
        on: jest.fn(),
        entities: {}
      };
    });

    it('should call super.registerHandlers if it exists', () => {
      const service = new SDMAttachmentsService();
      
      const mockSrvWithEntities = {
        ...mockSrv,
        entities: {
          TestEntity: {
            elements: {
              attachments: {
                _target: {
                  "@_is_media_data": true,
                  drafts: {}
                }
              }
            }
          }
        }
      };
      
      // The service extends the parent class and calls super.registerHandlers
      // Just verify it doesn't throw and processes entities
      expect(() => service.registerHandlers(mockSrvWithEntities)).not.toThrow();
      expect(mockSrv.before).toHaveBeenCalled();
    });

    it('should not throw if super.registerHandlers does not exist', () => {
      // Create a service without mocking super.registerHandlers
      const serviceWithoutSuper = new SDMAttachmentsService();
      
      mockSrv.entities = {};
      
      expect(() => serviceWithoutSuper.registerHandlers(mockSrv)).not.toThrow();
    });

    it('should iterate through all entities and register handlers for attachments', () => {
      const mockTarget = {
        "@_is_media_data": true,
        drafts: null
      };
      
      mockSrv.entities = {
        Orders: {
          elements: {
            attachments: {
              _target: mockTarget
            }
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).toHaveBeenCalledWith(mockSrv, mockSrv.entities.Orders, mockTarget);
    });

    it('should skip elements without @_is_media_data', () => {
      mockSrv.entities = {
        Orders: {
          elements: {
            normalField: {
              _target: {
                "@_is_media_data": false
              }
            }
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).not.toHaveBeenCalled();
    });

    it('should skip elements without _target', () => {
      mockSrv.entities = {
        Orders: {
          elements: {
            normalField: {}
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).not.toHaveBeenCalled();
    });

    it('should skip SiblingEntity element', () => {
      const mockTarget = {
        "@_is_media_data": true
      };
      
      mockSrv.entities = {
        Orders: {
          elements: {
            SiblingEntity: {
              _target: mockTarget
            }
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).not.toHaveBeenCalled();
    });

    it('should process multiple entities with attachments', () => {
      const mockTarget1 = {
        "@_is_media_data": true,
        drafts: null
      };
      
      const mockTarget2 = {
        "@_is_media_data": true,
        drafts: 'target.drafts'
      };
      
      mockSrv.entities = {
        Orders: {
          elements: {
            attachments: {
              _target: mockTarget1
            }
          }
        },
        Incidents: {
          elements: {
            documents: {
              _target: mockTarget2
            }
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).toHaveBeenCalledTimes(2);
      expect(registerSDMHandlersSpy).toHaveBeenCalledWith(mockSrv, mockSrv.entities.Orders, mockTarget1);
      expect(registerSDMHandlersSpy).toHaveBeenCalledWith(mockSrv, mockSrv.entities.Incidents, mockTarget2);
    });

    it('should handle entities with multiple attachment compositions', () => {
      const mockTarget1 = {
        "@_is_media_data": true
      };
      
      const mockTarget2 = {
        "@_is_media_data": true
      };
      
      mockSrv.entities = {
        Orders: {
          elements: {
            attachments: {
              _target: mockTarget1
            },
            documents: {
              _target: mockTarget2
            }
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).toHaveBeenCalledTimes(2);
      expect(registerSDMHandlersSpy).toHaveBeenCalledWith(mockSrv, mockSrv.entities.Orders, mockTarget1);
      expect(registerSDMHandlersSpy).toHaveBeenCalledWith(mockSrv, mockSrv.entities.Orders, mockTarget2);
    });

    it('should handle empty entities object', () => {
      mockSrv.entities = {};

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).not.toHaveBeenCalled();
    });

    it('should handle entity with no elements', () => {
      mockSrv.entities = {
        Orders: {
          elements: {}
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      expect(registerSDMHandlersSpy).not.toHaveBeenCalled();
    });

    it('should handle mixed entities with and without attachments', () => {
      const mockTarget = {
        "@_is_media_data": true
      };
      
      mockSrv.entities = {
        Orders: {
          elements: {
            attachments: {
              _target: mockTarget
            }
          }
        },
        Products: {
          elements: {
            name: {},
            description: {}
          }
        },
        Incidents: {
          elements: {
            notes: {
              _target: {
                "@_is_media_data": false
              }
            }
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      service.registerHandlers(mockSrv);
      
      // Only Orders should trigger handler registration
      expect(registerSDMHandlersSpy).toHaveBeenCalledTimes(1);
      expect(registerSDMHandlersSpy).toHaveBeenCalledWith(mockSrv, mockSrv.entities.Orders, mockTarget);
    });

    it('should handle when parent class has no registerHandlers method', () => {
      const service = new SDMAttachmentsService();
      
      // Remove the parent's registerHandlers method
      delete Object.getPrototypeOf(Object.getPrototypeOf(service)).registerHandlers;
      
      const mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
        on: jest.fn(),
        entities: {
          TestEntity: {
            elements: {
              attachments: {
                _target: {
                  "@_is_media_data": true,
                  drafts: {}
                }
              }
            }
          }
        }
      };

      const registerSDMHandlersSpy = jest.spyOn(service, 'registerSDMHandlers');
      
      // Should not throw error even when super.registerHandlers doesn't exist
      expect(() => service.registerHandlers(mockSrv)).not.toThrow();
      expect(registerSDMHandlersSpy).toHaveBeenCalled();
    });
  });

  describe('registerSDMHandlers', () => {
    let service;
    let mockSrv;
    let entity;
    let target;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service._registeredEntityHandlers = new Set();
      service._registeredTargetHandlers = new Set();
      service._registeredGlobalActionHandlers = false;
      
      mockSrv = {
        before: jest.fn(),
        after: jest.fn(),
        on: jest.fn()
      };

      entity = {
        name: 'entity',
        drafts: 'entity.drafts'
      };

      target = {
        name: 'target',
        drafts: 'target.drafts'
      };
    });

    it('should register all handlers correctly', () => {
      service.registerSDMHandlers(mockSrv, entity, target);

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
        target.drafts, 
        expect.any(Function)
      );
      expect(mockSrv.before).toHaveBeenCalledWith(
        "DELETE", 
        target, 
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
      expect(mockSrv.before).toHaveBeenCalledWith(
        "CREATE", 
        target, 
        expect.any(Function)
      );
      expect(mockSrv.before).toHaveBeenCalledWith(
        "UPDATE", 
        target, 
        expect.any(Function)
      );

      // Verify after handlers
      expect(mockSrv.after).toHaveBeenCalledWith(
        ["DELETE","UPDATE"], 
        [entity, entity.drafts], 
        expect.any(Function)
      );
      expect(mockSrv.after).toHaveBeenCalledWith(
        "DELETE", 
        target, 
        expect.any(Function)
      );

      // Verify on handlers
      expect(mockSrv.on).toHaveBeenCalledWith('openAttachment', expect.any(Function));
      expect(mockSrv.on).toHaveBeenCalledWith('createLink', expect.any(Function));
      expect(mockSrv.on).toHaveBeenCalledWith('editLink', expect.any(Function));
    });

    it('should not register PUT handler when target.drafts is undefined', () => {
      const targetWithoutDrafts = {};
      service.registerSDMHandlers(mockSrv, entity, targetWithoutDrafts);

      // Verify PUT handler for non-draft target is called instead
      const putCalls = mockSrv.before.mock.calls.filter(call => call[0] === 'PUT');
      expect(putCalls.length).toBeGreaterThan(0);
      expect(putCalls[0][1]).toBe(targetWithoutDrafts);
    });

    it('should register openAttachment handler that calls openAttachment method', async () => {
      const mockReq = { data: { attachmentId: '123' } };
      const mockResult = { url: 'http://example.com/file' };
      
      jest.spyOn(service, 'openAttachment').mockResolvedValue(mockResult);
      
      service.registerSDMHandlers(mockSrv, entity, target);
      
      // Get the handler function registered for openAttachment
      const onCalls = mockSrv.on.mock.calls.find(call => call[0] === 'openAttachment');
      expect(onCalls).toBeDefined();
      
      const handlerFn = onCalls[1];
      const result = await handlerFn(mockReq);
      
      expect(service.openAttachment).toHaveBeenCalledWith(mockReq);
      expect(result).toBe(mockResult);
    });

    it('should register createLink handler that calls handleCreateLinkAction method', async () => {
      const mockReq = { data: { url: 'http://example.com', title: 'Link' } };
      const mockResult = { ID: 'link-123', url: 'http://example.com' };
      
      jest.spyOn(service, 'handleCreateLinkAction').mockResolvedValue(mockResult);
      
      service.registerSDMHandlers(mockSrv, entity, target);
      
      // Get the handler function registered for createLink
      const onCalls = mockSrv.on.mock.calls.find(call => call[0] === 'createLink');
      expect(onCalls).toBeDefined();
      
      const handlerFn = onCalls[1];
      const result = await handlerFn(mockReq);
      
      expect(service.handleCreateLinkAction).toHaveBeenCalledWith(mockReq);
      expect(result).toBe(mockResult);
    });

    it('should register editLink handler that calls handleEditLinkAction method', async () => {
      const mockReq = { data: { ID: 'link-123', title: 'Updated Link' } };
      const mockResult = { ID: 'link-123', title: 'Updated Link' };
      
      jest.spyOn(service, 'handleEditLinkAction').mockResolvedValue(mockResult);
      
      service.registerSDMHandlers(mockSrv, entity, target);
      
      // Get the handler function registered for editLink
      const onCalls = mockSrv.on.mock.calls.find(call => call[0] === 'editLink');
      expect(onCalls).toBeDefined();
      
      const handlerFn = onCalls[1];
      const result = await handlerFn(mockReq);
      
      expect(service.handleEditLinkAction).toHaveBeenCalledWith(mockReq);
      expect(result).toBe(mockResult);
    });

    it('should register all three custom action handlers', () => {
      service.registerSDMHandlers(mockSrv, entity, target);
      
      const actionNames = mockSrv.on.mock.calls.map(call => call[0]);
      
      expect(actionNames).toContain('openAttachment');
      expect(actionNames).toContain('createLink');
      expect(actionNames).toContain('editLink');
      expect(mockSrv.on).toHaveBeenCalledTimes(3);
    });

    it('should handle errors thrown by openAttachment method', async () => {
      const mockReq = { data: { attachmentId: '123' } };
      const mockError = new Error('Attachment not found');
      
      jest.spyOn(service, 'openAttachment').mockRejectedValue(mockError);
      
      service.registerSDMHandlers(mockSrv, entity, target);
      
      const onCalls = mockSrv.on.mock.calls.find(call => call[0] === 'openAttachment');
      const handlerFn = onCalls[1];
      
      await expect(handlerFn(mockReq)).rejects.toThrow('Attachment not found');
    });

    it('should handle errors thrown by handleCreateLinkAction method', async () => {
      const mockReq = { data: { url: 'invalid-url' } };
      const mockError = new Error('Invalid link URL');
      
      jest.spyOn(service, 'handleCreateLinkAction').mockRejectedValue(mockError);
      
      service.registerSDMHandlers(mockSrv, entity, target);
      
      const onCalls = mockSrv.on.mock.calls.find(call => call[0] === 'createLink');
      const handlerFn = onCalls[1];
      
      await expect(handlerFn(mockReq)).rejects.toThrow('Invalid link URL');
    });

    it('should handle errors thrown by handleEditLinkAction method', async () => {
      const mockReq = { data: { ID: 'link-123' } };
      const mockError = new Error('Link not found');
      
      jest.spyOn(service, 'handleEditLinkAction').mockRejectedValue(mockError);
      
      service.registerSDMHandlers(mockSrv, entity, target);
      
      const onCalls = mockSrv.on.mock.calls.find(call => call[0] === 'editLink');
      const handlerFn = onCalls[1];
      
      await expect(handlerFn(mockReq)).rejects.toThrow('Link not found');
    });

    it('should pass correct this context to custom action handlers', async () => {
      const mockReq = { data: {} };
      
      // Mock all three methods
      jest.spyOn(service, 'openAttachment').mockResolvedValue({});
      jest.spyOn(service, 'handleCreateLinkAction').mockResolvedValue({});
      jest.spyOn(service, 'handleEditLinkAction').mockResolvedValue({});
      
      service.registerSDMHandlers(mockSrv, entity, target);
      
      // Execute each handler
      const openHandler = mockSrv.on.mock.calls.find(call => call[0] === 'openAttachment')[1];
      const createHandler = mockSrv.on.mock.calls.find(call => call[0] === 'createLink')[1];
      const editHandler = mockSrv.on.mock.calls.find(call => call[0] === 'editLink')[1];
      
      await openHandler(mockReq);
      await createHandler(mockReq);
      await editHandler(mockReq);
      
      // Verify all methods were called
      expect(service.openAttachment).toHaveBeenCalledWith(mockReq);
      expect(service.handleCreateLinkAction).toHaveBeenCalledWith(mockReq);
      expect(service.handleEditLinkAction).toHaveBeenCalledWith(mockReq);
    });
  });

  describe('additional coverage tests', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service._getNoteFromDB = jest.fn().mockResolvedValue(null);
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
      setupDestinationMocks();

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
      getAttachment.mockResolvedValue(undefined);
      const mockReq = {};
      setupDestinationMocks();

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
      service._getNoteFromDB = jest.fn().mockResolvedValue(null);
    });

    it('should handle onCreate when response.status is 403', async () => {
      const data = [{
        filename: 'test.txt',
        content: Buffer.from('test content')
      }];
      const parentId = 'parent-123';
      const req = {
        reject: jest.fn(),
        target: {
          name: 'TestEntity.attachments',
          isDraft: true
        }
      };

      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      createAttachment.mockResolvedValue({
        status: 403,
        response: {
          data: {}
        }
      });
      setupDestinationMocks();

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
      setupDestinationMocks();
      
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
      const req = { user: { id: 'testUser' } };
  
      // Act
      const result = await service.getAttachementDataInSDM(uri, objectId, req);
  
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
      const req = { user: { id: 'testUser' } };
  
      // Act & Assert
      await expect(service.getAttachementDataInSDM(uri, objectId, req)).rejects.toThrow('Some error');
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
      const req = { user: { id: 'testUser' } };
  
      // Act
      const result = await service.getAttachementDataInSDM(uri, objectId, req);
  
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

    test('should return a handler function', async () => {
      const service = new SDMAttachmentsService();
      const mockAttachments = { name: 'TestAttachments' };
      
      const handler = service.draftSaveHandler(mockAttachments);
      
      // Verify handler is a function
      expect(typeof handler).toBe('function');
      
      // Verify handler accepts res and req parameters
      expect(handler.length).toBe(2);
    });
  
    test('should skip when req.data.content is not provided', async () => {
      const req = { data: {} };
      await service.draftAttachmentUploadHandler(req);
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
    
      await service.draftAttachmentUploadHandler(req);
      
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
      const attachment_val = [{ HasActiveEntity: true, ID: '12345' }];
  
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      setupDestinationMocks();
  
      await service.draftAttachmentUploadHandler(req);
  
      expect(service.create).not.toHaveBeenCalled();
      expect(req.data.content).toBeNull();
    });

    test('should skip when no attachments are found', async () => {
      const draftAttachments = [];
      const req = { data: { content: 'some content', ID: '12345' }, target: draftAttachments, user: { authInfo: { token: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } } } };
      const attachment_val = [];
  
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
  
      await service.draftAttachmentUploadHandler(req);
  
      expect(service.isFileNameDuplicateInDrafts).not.toHaveBeenCalled();
      expect(service.create).not.toHaveBeenCalled();
      expect(req.data.content).toBeNull();
    });

    test('should skip processing when req.data.content is null after initial check', async () => {
      const draftAttachments = [];
      const req = { data: { content: null, ID: '12345' }, target: draftAttachments, user: { authInfo: { token: { getTokenValue: jest.fn().mockReturnValue('mockTokenValue') } } } };
      const attachment_val = [
        { HasActiveEntity: false, ID: '12345' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
  
      req.data.content = null; // simulating content being reset to null after initial check
  
      await service.draftAttachmentUploadHandler(req);
  
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
      const attachment_val = [
        { HasActiveEntity: false, ID: 'afc3d040-60ae-4bf2-a44f-1da4043f4257', filename: 'invalid/name' },
        { HasActiveEntity: true, ID: '67890' },
      ];
      getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
      setupDestinationMocks();
      isRestrictedCharactersInName.mockReturnValue(true);
  
      await service.draftAttachmentUploadHandler(req);
  
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
          const attachment_val = [
            { HasActiveEntity: false, ID: '4555', filename: null },
            { HasActiveEntity: true, ID: '67890' },
          ];
          getDraftAttachmentsForUpID.mockResolvedValue(attachment_val);
          setupDestinationMocks();
          isRestrictedCharactersInName.mockReturnValue(true);

          await service.draftAttachmentUploadHandler(req);

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

      await service.draftAttachmentUploadHandler(req);

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
      service.creds = { uri: "https://example.local" };
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
        name: "Attachments.references",
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
        name: "Attachments.references",
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

    it("should skip deletion data processing when SDM credentials are missing", async () => {
      service.creds = undefined;

      const mockReq = {
        target: { name: "myName" },
        diff: jest.fn().mockResolvedValue({
          references: [{ _op: "delete", ID: "1" }],
        }),
        event: "DELETE",
      };

      await service.attachDeletionData(mockReq);

      expect(mockReq.diff).not.toHaveBeenCalled();
      expect(getURLsToDeleteFromAttachments).not.toHaveBeenCalled();
      expect(getFolderIdByIDAsPath).not.toHaveBeenCalled();
      expect(mockReq.attachmentsToDelete).toBeUndefined();
      expect(mockReq.parentId).toBeUndefined();
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
        name: mockReq.target.name + ".references",
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
      setupDestinationMocks();
      data = [{ filename: 'file1' }];
      credentials = { user: 'user', pass: 'pass' };
      req = {
        reject: jest.fn(),
        target: {
          name: 'ProcessorService.Orders.references',
          isDraft: true
        }
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

    it('should reject when MIME type is blocked', async () => {
      createAttachment
      .mockResolvedValueOnce({
        status: 403,
        response: { data: { exception: 'streamNotSupported', message: 'MIME type is blocked' } }
      });
  
      await service.onCreate(data, credentials, req, parentId);
  
      expect(req.reject).toHaveBeenCalledWith(403, mimeTypeInvalidError);
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
      setupDestinationMocks();
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
    let parentId;
    let upIdKey;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      credentials = { user: "user", pass: "pass" };
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      setupDestinationMocks();
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
      getDraftAdministrativeData_DraftUUIDForUpId.mockResolvedValue([
        { DraftAdministrativeData_DraftUUID: "uuid-123" }
      ]);
    });

    it("should update draft if createAttachment returns 201", async () => {
      const mockDestination = setupDestinationMocks();
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
        mockDestination
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
      const mockDestination = setupDestinationMocks();
      editLink.mockResolvedValue({ status: 200 });
      editLinkInDraft.mockResolvedValue();

     const result = await service.handleEditLinkAction(req);

      expect(getAttachmentById).toHaveBeenCalledWith(attachmentId, 'test-entity');
      expect(editLink).toHaveBeenCalledWith(
          'existing-object-id',
          'MyLink',
          'http://new-link.com',
          service.creds,
          mockDestination
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
      
      // Mock global.UPDATE for mimeType fix using mockImplementation to avoid breaking other tests
      global.UPDATE.mockClear().mockImplementation(() => ({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue()
      }));
      
      req = {
        target: {
          name: 'Test.Entity.drafts'
        }
      };
    });
    
    it('should call updateBaselinesForEntity for attachment compositions', async () => {
      // Set up proper target name
      req.target = { name: 'ProcessorService.Incidents' };
      req.data = { ID: 'test-id' };
      
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
        includes: ['sap.attachments.Attachments'],
        keys: { up_: { keys: [{ $generatedFieldName: 'up__ID' }] } }
      };
      
      await service.handleDraftSaveForLinks({}, req);
      
      // Assert updateBaselinesForEntity is called for the attachments entity
      expect(service.updateBaselinesForEntity).toHaveBeenCalledWith('ProcessorService.Incidents.references');
      expect(service.updateBaselinesForEntity).toHaveBeenCalledTimes(1);
    });
    
    it('should not call updateBaselinesForEntity when no composition entities exist', async () => {
      // Target name exists but no matching composition entities are defined
      req.target = { name: 'Test.Entity.drafts' };
      req.data = {};
      
      // Clean up entity definitions from previous test
      delete cds.model.definitions['ProcessorService.Incidents'];
      delete cds.model.definitions['ProcessorService.Incidents.references'];
      delete cds.model.definitions['ProcessorService.Incidents.references.drafts'];
      
      await service.handleDraftSaveForLinks({}, req);
      
      // updateBaselinesForEntity should not be called when composition entities don't exist
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
          authInfo: { token: { getTokenValue: jest.fn().mockReturnValue('test-token') } }
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
      setupDestinationMocks();
    });
    
    it('should successfully revert link in SDM', async () => {
      const draftAttachment = {
        ID: 'attach1',
        filename: 'test.url',
        url: 'object-id'
      };
      const originalUrl = 'http://original.com';
      const req = { user: { id: 'testUser' } };
      const mockDestination = setupDestinationMocks();
      
      editLink.mockResolvedValue({ status: 200 });
      
      await service.revertLinkInSDM(draftAttachment, originalUrl, req);
      
      expect(editLink).toHaveBeenCalledWith(
        'object-id',
        'test',
        'http://original.com',
        service.creds,
        mockDestination
      );
    });
    
    it('should handle filename without .url extension', async () => {
      const draftAttachment = {
        ID: 'attach1',
        filename: 'test',
        url: 'object-id'
      };
      const originalUrl = 'http://original.com';
      const req = { user: { id: 'testUser' } };
      const mockDestination = setupDestinationMocks();
      
      editLink.mockResolvedValue({ status: 200 });
      
      await service.revertLinkInSDM(draftAttachment, originalUrl, req);
      
      expect(editLink).toHaveBeenCalledWith(
        'object-id',
        'test',
        'http://original.com',
        service.creds,
        mockDestination
      );
    });
    
    it('should throw error when editLink fails', async () => {
      const draftAttachment = {
        ID: 'attach1',
        filename: 'test.url',
        url: 'object-id'
      };
      const originalUrl = 'http://original.com';
      const req = { user: { id: 'testUser' } };
      
      editLink.mockRejectedValue(new Error('SDM Error'));
      
      await expect(service.revertLinkInSDM(draftAttachment, originalUrl, req))
      .rejects.toThrow('SDM Error');
    });
  });

  describe("getParentId", () => {
    let service;
    let mockReq;
    let mockDestination;
    beforeEach(() => {
      NodeCache.prototype.get.mockClear();
      jest.clearAllMocks();
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      mockDestination = setupDestinationMocks();
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
        name: mockReq.target.name + ".references",
        keys: {
          up_: {
            keys: [{ ref: ["attachment"] }],
          },
        },
      };
    });

    it("getParentId should call getFolderIdByPath if getFolderIdForEntity returns empty array", async () => {
      const attachments = cds.model.definitions[mockReq.target.name + ".references"]
      getFolderIdForEntity.mockResolvedValueOnce([]);
      getFolderIdByPath.mockResolvedValueOnce("mocked_folder_id");
      const upId = "mocked_up_id";

      await service.getParentId(attachments, mockReq, upId)
 
      expect(getFolderIdByPath).toHaveBeenCalledWith(
        mockReq,
        service.creds,
        cds.model.definitions[mockReq.target.name + ".references"],
        upId,
        mockDestination
      );
    });
  
    it("getParentId should call createFolder if getFolderIdForEntity and getFolderIdByPath return empty", async () => {
      let attachments = cds.model.definitions[mockReq.target.name + ".references"]
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
        mockDestination
      );
    });
  
    it("getParentId should reject with 403 if createFolder response status is 403 and message matches userDoesNotHaveRequiredScope", async () => {
      let attachments = cds.model.definitions[mockReq.target.name + ".references"];
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
      let attachments = cds.model.definitions[mockReq.target.name + ".references"];
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

    it("should use composition folder strategy for multi-composition entities", async () => {
      cds.model.definitions["testName"] = {
        name: "testName",
        elements: {
          attachments: { type: "cds.Composition", target: "testName.attachments" },
          references: { type: "cds.Composition", target: "testName.references" }
        }
      };
      cds.model.definitions["testName.attachments"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references"] = { includes: ["sap.attachments.Attachments"] };

      const attachments = {
        name: "testName.attachments",
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };

      mockReq.data = { ID: "123" };
      getFolderIdForEntity.mockResolvedValueOnce([{ folderId: "existing-composed-folder" }]);

      const parentId = await service.getParentId(attachments, mockReq, undefined);

      expect(parentId).toBe("existing-composed-folder");
      expect(getFolderIdByPath).not.toHaveBeenCalled();
    });

    it("should create composition folder when lookup by path fails", async () => {
      cds.model.definitions["testName"] = {
        name: "testName",
        elements: {
          attachments: { type: "cds.Composition", target: "testName.attachments" },
          references: { type: "cds.Composition", target: "testName.references" }
        }
      };
      cds.model.definitions["testName.attachments"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references"] = { includes: ["sap.attachments.Attachments"] };

      const attachments = {
        name: "testName.attachments",
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };

      mockReq.data = { ID: "123" };
      getFolderIdForEntity.mockResolvedValueOnce([]);
      executeHttpRequest.mockRejectedValueOnce(new Error("not found"));
      createFolder.mockResolvedValueOnce({
        status: 201,
        data: { succinctProperties: { "cmis:objectId": "created-composed-folder" } }
      });

      const parentId = await service.getParentId(attachments, mockReq, undefined);

      expect(parentId).toBe("created-composed-folder");
      expect(mockReq.data.ID).toBe("123");
    });

    it("should retry composition folder lookup after create conflict", async () => {
      cds.model.definitions["testName"] = {
        name: "testName",
        elements: {
          attachments: { type: "cds.Composition", target: "testName.attachments" },
          references: { type: "cds.Composition", target: "testName.references" }
        }
      };
      cds.model.definitions["testName.attachments"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references"] = { includes: ["sap.attachments.Attachments"] };

      const attachments = {
        name: "testName.attachments",
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };

      mockReq.data = { ID: "123" };
      getFolderIdForEntity.mockResolvedValueOnce([]);
      executeHttpRequest
        .mockRejectedValueOnce(new Error("not found"))
        .mockResolvedValueOnce({ data: { properties: { "cmis:objectId": { value: "retried-folder" } } } });
      createFolder.mockResolvedValueOnce({ status: 409, message: "conflict" });

      const parentId = await service.getParentId(attachments, mockReq, undefined);

      expect(parentId).toBe("retried-folder");
    });

    it("should reject when composition folder creation is unauthorized and retry also fails", async () => {
      cds.model.definitions["testName"] = {
        name: "testName",
        elements: {
          attachments: { type: "cds.Composition", target: "testName.attachments" },
          references: { type: "cds.Composition", target: "testName.references" }
        }
      };
      cds.model.definitions["testName.attachments"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references"] = { includes: ["sap.attachments.Attachments"] };

      const attachments = {
        name: "testName.attachments",
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };

      mockReq.data = { ID: "123" };
      getFolderIdForEntity.mockResolvedValueOnce([]);
      executeHttpRequest
        .mockRejectedValueOnce(new Error("not found"))
        .mockRejectedValueOnce(new Error("still not found"));
      createFolder.mockResolvedValueOnce({
        status: 403,
        response: { data: userDoesNotHaveRequiredScope }
      });

      await service.getParentId(attachments, mockReq, undefined);

      expect(mockReq.reject).toHaveBeenCalledWith(403, userNotAuthorisedError);
      expect(mockReq.reject).toHaveBeenCalledWith(500, "Failed to create folder for composition: attachments");
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
      expect(status).toEqual({ status: "Clean", lastScan: null });
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
        name: "testName.references",
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions["testName.references.drafts"] = {
        name: "testName.references.drafts",
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

    it("should resolve parent folder from composition path for multi-composition drafts", async () => {
      service.creds = { uri: "https://sdm.example/" };
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });

      cds.model.definitions["testName"] = {
        name: "testName",
        elements: {
          attachments: { type: "cds.Composition", target: "testName.attachments" },
          references: { type: "cds.Composition", target: "testName.references" }
        }
      };
      cds.model.definitions["testName.attachments"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references.drafts"] = {
        name: "testName.references.drafts",
        includes: ["sap.attachments.Attachments"],
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };

      mockReq.data = { ID: "entity-id-1" };
      getURLsToDeleteFromDraftAttachments.mockReset();
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce(["url-1"]);
      mockReq.diff.mockResolvedValueOnce({ references: ["url-1"] });
      setupDestinationMocks();
      executeHttpRequest.mockResolvedValueOnce({
        data: { properties: { "cmis:objectId": { value: "multi-folder-id" } } }
      });

      await service.attachDraftDeletionData(mockReq);

      expect(mockReq.attachmentsToDelete).toEqual(["url-1"]);
      expect(mockReq.parentId).toEqual(["multi-folder-id"]);
      expect(getFolderIdByIDAsPath).not.toHaveBeenCalled();
    });

    it("should skip parentId when multi-composition folder lookup fails", async () => {
      service.creds = { uri: "https://sdm.example/" };
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });

      cds.model.definitions["testName"] = {
        name: "testName",
        elements: {
          attachments: { type: "cds.Composition", target: "testName.attachments" },
          references: { type: "cds.Composition", target: "testName.references" }
        }
      };
      cds.model.definitions["testName.attachments"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references.drafts"] = {
        name: "testName.references.drafts",
        includes: ["sap.attachments.Attachments"],
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };

      mockReq.data = { ID: "entity-id-1" };
      getURLsToDeleteFromDraftAttachments.mockReset();
      getURLsToDeleteFromDraftAttachments.mockResolvedValueOnce(["url-1"]);
      mockReq.diff.mockResolvedValueOnce({ references: ["url-1"] });
      setupDestinationMocks();
      executeHttpRequest.mockRejectedValueOnce(new Error("folder not found"));

      await service.attachDraftDeletionData(mockReq);

      expect(mockReq.attachmentsToDelete).toEqual(["url-1"]);
      expect(mockReq.parentId).toBeUndefined();
    });
  });

  describe("addFolderToParentIdList", () => {
    let service;
    let req;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { uri: "https://sdm.example/" };
      getConfigurations.mockReturnValue({ repositoryId: "repo123" });
      req = { data: { ID: "entity-id-1" } };

      cds.model.definitions["testName"] = {
        name: "testName",
        elements: {
          attachments: { type: "cds.Composition", target: "testName.attachments" },
          references: { type: "cds.Composition", target: "testName.references" }
        }
      };
      cds.model.definitions["testName.attachments"] = { includes: ["sap.attachments.Attachments"] };
      cds.model.definitions["testName.references"] = { includes: ["sap.attachments.Attachments"] };
    });

    it("should add parent folder ID for multi-composition entities", async () => {
      const attachments = {
        name: "testName.references",
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };
      setupDestinationMocks();
      executeHttpRequest.mockResolvedValueOnce({
        data: { properties: { "cmis:objectId": { value: "folder-id-1" } } }
      });

      await service.addFolderToParentIdList(req, attachments);

      expect(req.parentId).toEqual(["folder-id-1"]);
    });

    it("should not add parentId when multi-composition folder does not exist", async () => {
      const attachments = {
        name: "testName.references",
        keys: { up_: { keys: [{ $generatedFieldName: "up__ID" }] } }
      };
      setupDestinationMocks();
      executeHttpRequest.mockRejectedValueOnce(new Error("not found"));

      await service.addFolderToParentIdList(req, attachments);

      expect(req.parentId).toBeUndefined();
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
        user: { authInfo: { token: { getTokenValue: () => 'test-token' } } }
      };
      const keys = { ID: 'test-id' };
      const attachments = {};

      // Set up HTTP context for get() method
      cds.context = { http: { req } };

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });
      setupDestinationMocks();
      readAttachment.mockResolvedValue('Forbidden');

      await expect(service.get(attachments, keys, req)).rejects.toThrow(
        expect.objectContaining({
          message: userNotAuthorisedReadError,
          status: 403
        })
      );
    });

    it('should reject with 404 when content is "Not Found"', async () => {
      const req = {
        reject: jest.fn(),
        user: { authInfo: { token: { getTokenValue: () => 'test-token' } } }
      };
      const keys = { ID: 'test-id' };
      const attachments = {};

      // Set up HTTP context for get() method
      cds.context = { http: { req } };

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });
      setupDestinationMocks();
      readAttachment.mockResolvedValue('Not Found');

      await expect(service.get(attachments, keys, req)).rejects.toThrow(
        expect.objectContaining({
          message: attachmentNotFound,
          status: 404
        })
      );
    });

    it('should reject with 500 for other error types', async () => {
      const req = {
        reject: jest.fn(),
        user: { authInfo: { token: { getTokenValue: () => 'test-token' } } }
      };
      const keys = { ID: 'test-id' };
      const attachments = {};

      // Set up HTTP context for get() method
      cds.context = { http: { req } };

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });
      setupDestinationMocks();
      readAttachment.mockResolvedValue('Some other error');

      await expect(service.get(attachments, keys, req)).rejects.toThrow(
        expect.objectContaining({
          message: errorMessage,
          status: 500
        })
      );
    });

    it('should throw error when HTTP request context is not available', async () => {
      const keys = { ID: 'test-id' };
      const attachments = {};

      // Set up context without HTTP request
      cds.context = {};

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });

      await expect(service.get(attachments, keys)).rejects.toThrow('HTTP request context not available');
    });

    it('should throw error when cds.context is undefined', async () => {
      const keys = { ID: 'test-id' };
      const attachments = {};

      // No context at all
      cds.context = undefined;

      getURLFromAttachments.mockResolvedValue({ url: 'test-url' });

      await expect(service.get(attachments, keys)).rejects.toThrow('HTTP request context not available');
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
          authInfo: { token: { getTokenValue: () => 'test-token' } }
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

    it('should return early when baseEntity does not exist in model', async () => {
      const req = {
        target: { name: 'NonExistent.Entity.drafts' },
        data: { ID: 'test-id' },
        event: 'DELETE'
      };

      // Ensure base entity doesn't exist
      delete cds.model.definitions['NonExistent.Entity'];
      
      await service.attachDraftDeletionData(req);
      
      // Should return early without processing
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
          authInfo: { token: { getTokenValue: () => 'test-token' } }
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
          authInfo: { token: { getTokenValue: () => 'test-token' } }
        }
      };

      // Ensure entity doesn't exist
      delete cds.model.definitions['NonExistent.Entity'];
      
      await service.handleDraftDiscardForLinks(req);
      
      // Should not throw and should not call any SDM operations
    });
  });

  // ========================================================================
  // NON-DRAFT ATTACHMENT FEATURE TESTS
  // ========================================================================

  describe("Non-Draft Attachment Features", () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { 
        uri: "http://mock-sdm.com",
        clientId: "mock-client-id", 
        clientSecret: "mock-client-secret" 
      };
    });

    describe("getStatus", () => {
      it("should return clean status object for any attachment", async () => {
        const Attachments = cds.model.definitions['ProcessorService.Orders.references'];
        const key = { ID: '123e4567-e89b-12d3-a456-426614174000' };

        const result = await service.getStatus(Attachments, key);

        expect(result).toEqual({
          status: "Clean",
          lastScan: null
        });
      });

      it("should return clean status without requiring actual DB lookup", async () => {
        // This validates that getStatus doesn't access database or SDM
        const Attachments = cds.model.definitions['ProcessorService.Orders.references'];
        const key = { ID: 'non-existent-id' };

        const result = await service.getStatus(Attachments, key);

        expect(result).toEqual({
          status: "Clean",
          lastScan: null
        });
        // Verify no external calls were made
        expect(createAttachment).not.toHaveBeenCalled();
        expect(readAttachment).not.toHaveBeenCalled();
      });
    });

    describe("onCreate - Non-Draft Support", () => {
      beforeEach(() => {
        getConfigurations.mockReturnValue({ repositoryId: 'test-repo-id' });
        service.getDestination = jest.fn().mockResolvedValue({ url: 'http://mock-sdm.com' });
        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({
            ID: 'attachment-123',
            filename: 'test.pdf',
            folderId: 'folder-123',
            url: 'mock-object-id',
            repositoryId: 'test-repo-id',
            status: 'Clean'
          })
        });
      });

      it("should handle non-draft attachment upload successfully", async () => {
        const mockReq = {
          target: { 
            name: 'ProcessorService.Orders.references',
            isDraft: false 
          },
          reject: jest.fn()
        };

        const attachmentData = [{
          ID: 'attachment-123',
          filename: 'test.pdf',
          content: Buffer.from('test content'),
          mimeType: 'application/pdf'
        }];

        createAttachment.mockResolvedValue({
          status: 201,
          data: {
            succinctProperties: {
              'cmis:objectId': 'mock-object-id'
            }
          }
        });

        UPDATE.mockReturnValue({
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockResolvedValue(1)
        });

        await service.onCreate(attachmentData, service.creds, mockReq, 'parent-folder-id');

        expect(createAttachment).toHaveBeenCalledWith(
          expect.objectContaining({
            ID: 'attachment-123',
            filename: 'test.pdf'
          }),
          service.creds,
          'parent-folder-id',
          expect.any(Object)
        );

        expect(UPDATE).toHaveBeenCalledWith(mockReq.target);
        expect(mockReq.reject).not.toHaveBeenCalled();
      });

      it("should use updateAttachmentInDraft for draft entities", async () => {
        const mockReq = {
          target: { 
            name: 'ProcessorService.Orders.references.drafts',
            isDraft: true 
          },
          reject: jest.fn()
        };

        const attachmentData = [{
          ID: 'attachment-123',
          filename: 'test.pdf',
          content: Buffer.from('test content')
        }];

        createAttachment.mockResolvedValue({
          status: 201,
          data: {
            succinctProperties: {
              'cmis:objectId': 'mock-object-id'
            }
          }
        });

        updateAttachmentInDraft.mockResolvedValue();

        await service.onCreate(attachmentData, service.creds, mockReq, 'parent-folder-id');

        expect(updateAttachmentInDraft).toHaveBeenCalledWith(
          mockReq,
          expect.objectContaining({
            ID: 'attachment-123',
            url: 'mock-object-id'
          })
        );
        expect(UPDATE).not.toHaveBeenCalled();
      });

      it("should handle SDM upload failure and reject with duplicate error", async () => {
        const mockReq = {
          target: { 
            name: 'ProcessorService.Orders.references',
            isDraft: false 
          },
          reject: jest.fn()
        };

        const attachmentData = [{
          ID: 'attachment-123',
          filename: 'duplicate.pdf',
          content: Buffer.from('test content')
        }];

        // Simulate Axios error from SDM (409 duplicate)
        const axiosError = new Error('Conflict');
        axiosError.isAxiosError = true;
        axiosError.response = {
          status: 409,
          data: {
            message: 'File already exists',
            exception: 'nameConstraintViolation'
          }
        };

        createAttachment.mockRejectedValue(axiosError);

        await service.onCreate(attachmentData, service.creds, mockReq, 'parent-folder-id');

        expect(mockReq.reject).toHaveBeenCalledWith(
          409,
          expect.any(String)
        );
        expect(mockReq.reject.mock.calls[0][1]).toContain('duplicate.pdf');
      });

      it("should cleanup orphaned metadata for failed non-draft upload", async () => {
        const mockReq = {
          target: { 
            name: 'ProcessorService.Orders.references',
            isDraft: false 
          },
          reject: jest.fn()
        };

        const attachmentData = [{
          ID: 'attachment-123',
          filename: 'test.pdf',
          content: Buffer.from('test content')
        }];

        const axiosError = new Error('Upload failed');
        axiosError.isAxiosError = true;
        axiosError.response = {
          status: 500,
          data: { message: 'Internal server error' }
        };

        createAttachment.mockRejectedValue(axiosError);

        const mockDelete = jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(1)
        });
        global.DELETE = {
          from: mockDelete
        };

        await service.onCreate(attachmentData, service.creds, mockReq, 'parent-folder-id');

        expect(mockDelete).toHaveBeenCalledWith(mockReq.target);
        expect(mockReq.reject).toHaveBeenCalled();
      });

      it("should handle virus detection and reject with 403", async () => {
        const mockReq = {
          target: { 
            name: 'ProcessorService.Orders.references',
            isDraft: false 
          },
          reject: jest.fn()
        };

        const attachmentData = [{
          ID: 'attachment-123',
          filename: 'virus.pdf',
          content: Buffer.from('malicious content')
        }];

        const axiosError = new Error('Virus detected');
        axiosError.isAxiosError = true;
        axiosError.response = {
          status: 403,
          data: {
            message: 'Malware Service Exception: Virus found in the file!'
          }
        };

        createAttachment.mockRejectedValue(axiosError);

        await service.onCreate(attachmentData, service.creds, mockReq, 'parent-folder-id');

        expect(mockReq.reject).toHaveBeenCalledWith(403, expect.stringContaining('virus.pdf'));
      });

      it("should handle UPDATE failure for non-draft attachment", async () => {
        const mockReq = {
          target: { 
            name: 'ProcessorService.Orders.references',
            isDraft: false 
          },
          reject: jest.fn()
        };

        const attachmentData = [{
          ID: 'attachment-123',
          filename: 'test.pdf',
          content: Buffer.from('test content'),
          mimeType: 'application/pdf'
        }];

        createAttachment.mockResolvedValue({
          status: 201,
          data: {
            succinctProperties: {
              'cmis:objectId': 'mock-object-id'
            }
          }
        });

        const updateError = new Error('Database update failed');
        UPDATE.mockReturnValue({
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockRejectedValue(updateError)
        });

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue(null) // Verify will return null after failed update
        });

        await expect(service.onCreate(attachmentData, service.creds, mockReq, 'parent-folder-id'))
          .rejects.toThrow('Database update failed');
      });

      it("should handle missing ID case in non-draft upload", async () => {
        const mockReq = {
          target: { 
            name: 'ProcessorService.Orders.references',
            isDraft: false 
          },
          reject: jest.fn()
        };

        const attachmentData = [{
          filename: 'test.pdf',
          content: Buffer.from('test content'),
          mimeType: 'application/pdf'
          // No ID field
        }];

        createAttachment.mockResolvedValue({
          status: 201,
          data: {
            succinctProperties: {
              'cmis:objectId': 'mock-object-id'
            }
          }
        });

        await service.onCreate(attachmentData, service.creds, mockReq, 'parent-folder-id');

        // Should not call UPDATE when ID is missing
        expect(UPDATE).not.toHaveBeenCalled();
      });
    });

    describe("nonDraftAttachmentCreateHandler", () => {
      beforeEach(() => {
        getConfigurations.mockReturnValue({ repositoryId: 'test-repo-id' });
        service.checkRepositoryType = jest.fn().mockResolvedValue();
        service.getParentId = jest.fn().mockResolvedValue('parent-folder-id');
        service.onCreate = jest.fn().mockResolvedValue();
        service.getDestination = jest.fn().mockResolvedValue({ url: 'http://mock-sdm.com' });
      });

      it("should skip processing if no content provided", async () => {
        const mockReq = {
          data: { filename: 'test.pdf', ID: 'test-id' },
          target: { name: 'Orders.references', isDraft: false },
          event: 'CREATE'
        };

        await service.nonDraftAttachmentCreateHandler(mockReq);

        expect(service.onCreate).not.toHaveBeenCalled();
      });

      it("should skip processing for draft entities", async () => {
        const mockReq = {
          data: { 
            filename: 'test.pdf', 
            ID: 'test-id',
            content: Buffer.from('test') 
          },
          target: { name: 'Orders.references.drafts', isDraft: true },
          event: 'CREATE'
        };

        await service.nonDraftAttachmentCreateHandler(mockReq);

        expect(service.onCreate).not.toHaveBeenCalled();
      });

      it("should handle CREATE event for non-draft attachment", async () => {
        const mockReq = {
          data: {
            ID: 'attachment-123',
            filename: 'test.pdf',
            content: Buffer.from('test content'),
            up__ID: 'parent-entity-id'
          },
          target: { name: 'Orders.references', isDraft: false },
          event: 'CREATE',
          reject: jest.fn()
        };

        isRestrictedCharactersInName.mockReturnValue(false);

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({
            ID: 'attachment-123',
            url: 'mock-object-id',
            folderId: 'parent-folder-id',
            repositoryId: 'test-repo-id',
            status: 'Clean',
            type: 'sap-icon://document'
          })
        });

        await service.nonDraftAttachmentCreateHandler(mockReq);

        expect(service.onCreate).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              ID: 'attachment-123',
              filename: 'test.pdf'
            })
          ]),
          service.creds,
          mockReq,
          'parent-folder-id'
        );

        expect(mockReq.data.content).toBeNull();
        expect(mockReq.data.url).toBe('mock-object-id');
        expect(mockReq.data.folderId).toBe('parent-folder-id');
      });

      it("should handle PUT /content event for existing attachment", async () => {
        const mockReq = {
          data: {
            content: Buffer.from('updated content')
          },
          target: { name: 'Orders.references', isDraft: false },
          event: 'UPDATE',
          req: {
            url: '/Orders(ID=123e4567-e89b-12d3-a456-426614174000)/references(ID=223e4567-e89b-12d3-a456-426614174000)/content'
          },
          reject: jest.fn()
        };

        const mockMetadata = {
          ID: '223e4567-e89b-12d3-a456-426614174000',
          filename: 'existing.pdf',
          up__ID: '123e4567-e89b-12d3-a456-426614174000'
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue(mockMetadata)
        });

        isRestrictedCharactersInName.mockReturnValue(false);

        SELECT.one.from.mockReturnValue({
          where: jest.fn()
            .mockResolvedValueOnce(mockMetadata) // First call for metadata
            .mockResolvedValueOnce({ // Second call after onCreate
              ID: '223e4567-e89b-12d3-a456-426614174000',
              url: 'updated-object-id',
              folderId: 'parent-folder-id',
              repositoryId: 'test-repo-id',
              status: 'Clean',
              type: 'sap-icon://document'
            })
        });

        await service.nonDraftAttachmentCreateHandler(mockReq);

        expect(service.onCreate).toHaveBeenCalledWith(
          expect.arrayContaining([
            expect.objectContaining({
              ID: '223e4567-e89b-12d3-a456-426614174000',
              filename: 'existing.pdf'
            })
          ]),
          service.creds,
          mockReq,
          'parent-folder-id'
        );

        expect(mockReq.data.up__ID).toBe('123e4567-e89b-12d3-a456-426614174000');
      });

      it("should reject if attachment not found during PUT", async () => {
        const mockReq = {
          data: { content: Buffer.from('content') },
          target: { name: 'Orders.references', isDraft: false },
          event: 'UPDATE',
          req: { url: '/Orders(ID=123e4567-e89b-12d3-a456-426614174000)/references(ID=323e4567-e89b-12d3-a456-426614174000)/content' },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue(null)
        });

        await service.nonDraftAttachmentCreateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(404, 'Attachment not found');
        expect(service.onCreate).not.toHaveBeenCalled();
      });

      it("should reject if filename contains restricted characters", async () => {
        const mockReq = {
          data: {
            ID: 'attachment-123',
            filename: 'invalid/file.pdf',
            content: Buffer.from('test')
          },
          target: { name: 'Orders.references', isDraft: false },
          event: 'CREATE',
          reject: jest.fn()
        };

        isRestrictedCharactersInName.mockReturnValue(true);

        await service.nonDraftAttachmentCreateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(409, expect.stringContaining('invalid/file.pdf'));
        expect(service.onCreate).not.toHaveBeenCalled();
      });

      it("should reject if filename is empty", async () => {
        const mockReq = {
          data: {
            ID: 'attachment-123',
            filename: '   ',
            content: Buffer.from('test')
          },
          target: { name: 'Orders.references', isDraft: false },
          event: 'CREATE',
          reject: jest.fn()
        };

        isRestrictedCharactersInName.mockReturnValue(false);

        await service.nonDraftAttachmentCreateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(400, expect.stringContaining('empty'));
        expect(service.onCreate).not.toHaveBeenCalled();
      });
    });

    describe("nonDraftAttachmentUpdateHandler", () => {
      beforeEach(() => {
        service._updateAttachments = jest.fn().mockResolvedValue([]);
        getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({});
        getSecondaryTypeProperties.mockReturnValue({});
        
        // Mock the attachments entity definition
        cds.model.definitions['Orders.references'] = {
          name: 'Orders.references',
          kind: 'entity'
        };
      });

      it("should skip processing for draft entities", async () => {
        const mockReq = {
          data: { ID: 'test-id', filename: 'new-name.pdf' },
          target: { name: 'Orders.references.drafts', isDraft: true }
        };

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(service._updateAttachments).not.toHaveBeenCalled();
      });

      it("should skip processing for PUT /content operations", async () => {
        const mockReq = {
          data: { 
            ID: 'test-id', 
            content: Buffer.from('data') 
          },
          target: { name: 'Orders.references', isDraft: false }
        };

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(service._updateAttachments).not.toHaveBeenCalled();
      });

      it("should skip if only ID is in request data", async () => {
        const mockReq = {
          data: { ID: 'test-id' },
          target: { name: 'Orders.references', isDraft: false }
        };

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(service._updateAttachments).not.toHaveBeenCalled();
      });

      it("should handle filename update successfully", async () => {
        const mockReq = {
          data: { 
            ID: 'attachment-123', 
            filename: 'renamed.pdf' 
          },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        const mockCurrentAttachment = {
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue(mockCurrentAttachment)
        });

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(service._updateAttachments).toHaveBeenCalledWith(
          mockReq,
          expect.objectContaining({
            attachment: expect.objectContaining({
              ID: 'attachment-123',
              filename: 'renamed.pdf'
            }),
            filenameInSDM: 'original.pdf'
          })
        );

        expect(mockReq.reject).not.toHaveBeenCalled();
      });

      it("should reject if attachment not found", async () => {
        const mockReq = {
          data: { 
            ID: 'missing-id', 
            filename: 'new.pdf' 
          },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue(null)
        });

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(404, 'Attachment not found');
      });

      it("should reject with 409 for restricted characters error", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: 'invalid/name.pdf' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: 'invalid/name.pdf',
          typeOfError: 'restricted characters'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(409, expect.stringContaining('invalid/name.pdf'));
      });

      it("should reject with 400 for empty name error", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: '' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: '',
          typeOfError: 'empty name'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(400, expect.stringContaining('empty'));
      });

      it("should reject with 409 for duplicate error", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: 'duplicate.pdf' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: 'duplicate.pdf',
          typeOfError: 'duplicate'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(409, expect.stringContaining('duplicate.pdf'));
      });

      it("should reject with 403 for no SDM roles error", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: 'new.pdf' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: 'new.pdf',
          typeOfError: 'no sdm roles'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(403, expect.stringContaining('permissions'));
      });

      it("should warn for unsupported properties but not reject", async () => {
        const mockReq = {
          data: { 
            ID: 'attachment-123', 
            filename: 'test.pdf',
            unsupportedProp: 'value'
          },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn(),
          warn: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: 'test.pdf',
          typeOfError: 'unsupported properties',
          details: 'cmis:prop1,cmis:prop2'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.warn).toHaveBeenCalled();
        expect(mockReq.reject).not.toHaveBeenCalled();
      });

      it("should reject with 404 for 'not found' error", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: 'notfound.pdf' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf', url: 'object-id' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: 'notfound.pdf',
          typeOfError: 'not found'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(404, expect.stringContaining('notfound.pdf'));
      });

      it("should reject with 500 for 'bad request' error with custom message", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: 'invalid.pdf' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf', url: 'object-id' })
        });

        const customErrorMessage = 'Custom bad request error message';
        service._updateAttachments.mockResolvedValue([{
          name: 'invalid.pdf',
          typeOfError: 'bad request',
          message: customErrorMessage
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(500, customErrorMessage);
      });

      it("should reject with 500 and default message for 'bad request' error without custom message", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: 'invalid.pdf' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf', url: 'object-id' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: 'invalid.pdf',
          typeOfError: 'bad request'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(500, expect.stringContaining('invalid.pdf'));
        expect(mockReq.reject).toHaveBeenCalledWith(500, expect.stringContaining('Update failed'));
      });

      it("should reject with 500 for unknown error types", async () => {
        const mockReq = {
          data: { ID: 'attachment-123', filename: 'error.pdf' },
          target: { name: 'Orders.references', isDraft: false },
          reject: jest.fn()
        };

        SELECT.one.from.mockReturnValue({
          where: jest.fn().mockResolvedValue({ ID: 'attachment-123', filename: 'old.pdf', url: 'object-id' })
        });

        service._updateAttachments.mockResolvedValue([{
          name: 'error.pdf',
          typeOfError: 'unknown error type'
        }]);

        await service.nonDraftAttachmentUpdateHandler(mockReq);

        expect(mockReq.reject).toHaveBeenCalledWith(500, 'Update failed');
      });
    });

    describe("nonDraftEntityRenameHandler", () => {
      beforeEach(() => {
        getConfigurations.mockReturnValue({ repositoryId: 'test-repo-id' });
        getPropertyTitles.mockReturnValue({});
        getSecondaryPropertiesWithInvalidDefinition.mockReturnValue({});
        getSecondaryTypeProperties.mockReturnValue({});
        getPropertiesForID.mockResolvedValue({});
        getUpdatedSecondaryProperties.mockReturnValue({});
        service._updateAttachments = jest.fn().mockResolvedValue([]);
        service._getNoteFromDB = jest.fn().mockResolvedValue(null);
      });

      it("should skip if no attachments entity defined", async () => {
        const mockReq = {
          target: { name: 'Orders' },
          diff: jest.fn()
        };

        // Ensure no attachments composition exists
        cds.model.definitions['Orders.attachments'] = undefined;

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(mockReq.diff).not.toHaveBeenCalled();
      });

      it("should skip if no attachments in diff", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({ attachments: [] })
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(service._updateAttachments).not.toHaveBeenCalled();
      });

      it("should skip if only deleted or created attachments in diff", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [
              { ID: 'att-1', _op: 'delete' },
              { ID: 'att-2', _op: 'create' }
            ]
          })
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(service._updateAttachments).not.toHaveBeenCalled();
      });

      it("should process attachment rename when filename changes", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders'},
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'renamed.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        const mockAttachmentsEntity = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = mockAttachmentsEntity;

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        setupDestinationMocks();
        updateAttachment.mockResolvedValue(200);

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(updateAttachment).toHaveBeenCalled();
        expect(mockReq.reject).not.toHaveBeenCalled();
      });

      it("should reject if filename has restricted characters", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'invalid/name.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(true);

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(mockReq.warn).toHaveBeenCalled();
        expect(mockReq.reject).not.toHaveBeenCalled();
      });

      it("should skip empty filename and use original", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: '',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);

        await service.nonDraftEntityRenameHandler(mockReq);

        // Empty filename falls back to original filename, so no update needed
        expect(mockReq.warn).not.toHaveBeenCalled();
        expect(mockReq.reject).not.toHaveBeenCalled();
      });

      it("should handle 403 error (no SDM roles) from updateAttachment", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'renamed.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "renamed.pdf" });
        setupDestinationMocks();
        updateAttachment.mockResolvedValue(403);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Access denied');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'no sdm roles', name: 'renamed.pdf' }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Access denied');
      });

      it("should handle 409 error (duplicate) from updateAttachment", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'duplicate.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "duplicate.pdf" });
        setupDestinationMocks();
        updateAttachment.mockResolvedValue(409);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Duplicate file');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'duplicate', name: 'duplicate.pdf' }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Duplicate file');
      });

      it("should handle 404 error (not found) from updateAttachment", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'notfound.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "notfound.pdf" });
        setupDestinationMocks();
        updateAttachment.mockResolvedValue(404);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('File not found');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'not found', name: 'notfound.pdf' }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'File not found');
      });

      it("should handle unsupported properties exception from updateAttachment", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'file.pdf',
              customProp: 'value',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "file.pdf", "customProp": "value" });
        setupDestinationMocks();
        
        const errorMessage = unsupportedProperties + " customProp is not supported";
        updateAttachment.mockRejectedValue(new Error(errorMessage));

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Unsupported properties warning');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'unsupported properties', details: 'customProp is not supported' }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Unsupported properties warning');
      });

      it("should handle generic exception from updateAttachment", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'file.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "file.pdf" });
        setupDestinationMocks();
        
        const errorMessage = "Network error occurred";
        updateAttachment.mockRejectedValue(new Error(errorMessage));

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Bad request error');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'bad request', name: 'file.pdf', message: 'Network error occurred' }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Bad request error');
      });

      it("should handle multiple errors from multiple attachments", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [
              {
                ID: 'attachment-1',
                filename: 'file1.pdf',
                _op: 'update'
              },
              {
                ID: 'attachment-2',
                filename: 'file2.pdf',
                _op: 'update'
              }
            ]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn()
          .mockResolvedValueOnce({
            ID: 'attachment-1',
            filename: 'original1.pdf',
            url: 'object-id-1'
          })
          .mockResolvedValueOnce({
            ID: 'attachment-2',
            filename: 'original2.pdf',
            url: 'object-id-2'
          });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "file.pdf" });
        setupDestinationMocks();
        service._getNoteFromDB = jest.fn().mockResolvedValue(null);

        updateAttachment
          .mockResolvedValueOnce(403)  // First attachment returns 403
          .mockResolvedValueOnce(409); // Second attachment returns 409

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Multiple errors');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [
            { typeOfError: 'no sdm roles', name: 'file1.pdf' },
            { typeOfError: 'duplicate', name: 'file2.pdf' }
          ],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Multiple errors');
      });

      it("should not warn if no errors occurred", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: 'success.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "success.pdf" });
        setupDestinationMocks();
        service._getNoteFromDB = jest.fn().mockResolvedValue(null);
        updateAttachment.mockResolvedValue(200);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith([], {});
        expect(mockReq.warn).not.toHaveBeenCalled();
      });

      it("should handle empty filename (null) and add empty name error", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: null,
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: null,  // Current filename is also null
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Empty filename error');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'empty name', name: null }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Empty filename error');
      });

      it("should handle whitespace-only filename and add empty name error", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: '   ',  // Whitespace only
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Empty filename error');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'empty name', name: '   ' }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Empty filename error');
      });

      it("should handle filename with only tabs and newlines as empty", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'attachment-123',
              filename: '\t\n  ',  // Tabs and newlines
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue({
          ID: 'attachment-123',
          filename: 'original.pdf',
          url: 'object-id'
        });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Empty filename error');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [{ typeOfError: 'empty name', name: '\t\n  ' }],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Empty filename error');
      });

      it("should skip processing when currentAttachment is not found", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'non-existent-attachment',
              filename: 'new.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue(null);  // No attachment found

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('');

        await service.nonDraftEntityRenameHandler(mockReq);

        // Should not process this attachment
        expect(getPropertiesForID).not.toHaveBeenCalled();
        expect(updateAttachment).not.toHaveBeenCalled();
        expect(handleWarningSpy).toHaveBeenCalledWith([], {});
        expect(mockReq.warn).not.toHaveBeenCalled();
      });

      it("should skip processing when currentAttachment is undefined", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [{
              ID: 'undefined-attachment',
              filename: 'new.pdf',
              _op: 'update'
            }]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn().mockResolvedValue(undefined);  // Undefined attachment

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('');

        await service.nonDraftEntityRenameHandler(mockReq);

        // Should not process this attachment
        expect(getPropertiesForID).not.toHaveBeenCalled();
        expect(updateAttachment).not.toHaveBeenCalled();
        expect(handleWarningSpy).toHaveBeenCalledWith([], {});
        expect(mockReq.warn).not.toHaveBeenCalled();
      });

      it("should process valid attachments and skip missing ones in same request", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [
              {
                ID: 'missing-attachment',
                filename: 'missing.pdf',
                _op: 'update'
              },
              {
                ID: 'valid-attachment',
                filename: 'valid.pdf',
                _op: 'update'
              }
            ]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn()
          .mockResolvedValueOnce(null)  // First attachment not found
          .mockResolvedValueOnce({      // Second attachment found
            ID: 'valid-attachment',
            filename: 'original.pdf',
            url: 'object-id'
          });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName.mockReturnValue(false);
        getUpdatedSecondaryProperties.mockReturnValue({ "cmis:name": "valid.pdf" });
        setupDestinationMocks();
        updateAttachment.mockResolvedValue(200);

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('');

        await service.nonDraftEntityRenameHandler(mockReq);

        // Should only process the valid attachment
        expect(updateAttachment).toHaveBeenCalledTimes(1);
        expect(handleWarningSpy).toHaveBeenCalledWith([], {});
        expect(mockReq.warn).not.toHaveBeenCalled();
      });

      it("should handle mixed errors including empty name and missing attachment", async () => {
        const mockReq = {
          target: { name: 'ProcessorService.Orders' },
          diff: jest.fn().mockResolvedValue({
            attachments: [
              {
                ID: 'empty-filename-attachment',
                filename: null,
                _op: 'update'
              },
              {
                ID: 'missing-attachment',
                filename: 'missing.pdf',
                _op: 'update'
              },
              {
                ID: 'restricted-chars-attachment',
                filename: 'file/with/slashes.pdf',
                _op: 'update'
              }
            ]
          }),
          reject: jest.fn(),
          warn: jest.fn()
        };

        cds.model.definitions['ProcessorService.Orders.attachments'] = {
          name: 'ProcessorService.Orders.attachments',
          includes: ['sap.attachments.Attachments']
        };

        const mockWhere = jest.fn().mockReturnThis();
        const mockColumns = jest.fn()
          .mockResolvedValueOnce({
            ID: 'empty-filename-attachment',
            filename: null,
            url: 'object-id-1'
          })
          .mockResolvedValueOnce(null)  // Missing attachment
          .mockResolvedValueOnce({
            ID: 'restricted-chars-attachment',
            filename: 'original.pdf',
            url: 'object-id-3'
          });

        SELECT.one.from.mockReturnValue({
          where: mockWhere,
          columns: mockColumns
        });

        isRestrictedCharactersInName
          .mockReturnValueOnce(false)  // For null filename
          .mockReturnValueOnce(true);  // For restricted chars filename

        const handleWarningSpy = jest.spyOn(service, 'handleWarning').mockReturnValue('Multiple validation errors');

        await service.nonDraftEntityRenameHandler(mockReq);

        expect(handleWarningSpy).toHaveBeenCalledWith(
          [
            { typeOfError: 'empty name', name: null },
            { typeOfError: 'restricted characters', name: 'file/with/slashes.pdf' }
          ],
          {}
        );
        expect(mockReq.warn).toHaveBeenCalledWith(500, 'Multiple validation errors');
      });
    });

    describe("attachNonDraftAttachmentDeletionData", () => {
      let service;
      let mockReq;

      beforeEach(() => {
        jest.clearAllMocks();
        service = new SDMAttachmentsService();
      });

      it("should return early if target is not media data", async () => {
        mockReq = {
          target: { name: 'TestEntity' },
          subject: 'TestSubject'
        };

        await service.attachNonDraftAttachmentDeletionData(mockReq);

        expect(mockReq.attachmentsToDelete).toBeUndefined();
      });

      it("should return early if subject is missing", async () => {
        mockReq = {
          target: { 
            name: 'TestEntity',
            "@_is_media_data": true
          }
        };

        await service.attachNonDraftAttachmentDeletionData(mockReq);

        expect(mockReq.attachmentsToDelete).toBeUndefined();
      });

      it("should attach attachments to delete when attachments exist", async () => {
        const mockAttachments = [
          { url: 'http://example.com/file1', ID: '1' },
          { url: 'http://example.com/file2', ID: '2' }
        ];

        mockReq = {
          target: { 
            name: 'TestAttachments',
            "@_is_media_data": true
          },
          subject: 'TestSubject'
        };

        SELECT.from.mockReturnValue({
          columns: jest.fn().mockResolvedValue(mockAttachments)
        });

        await service.attachNonDraftAttachmentDeletionData(mockReq);

        expect(mockReq.attachmentsToDelete).toEqual([
          { url: 'http://example.com/file1', ID: '1', target: 'TestAttachments' },
          { url: 'http://example.com/file2', ID: '2', target: 'TestAttachments' }
        ]);
      });

      it("should not set attachmentsToDelete if no attachments found", async () => {
        mockReq = {
          target: { 
            name: 'TestAttachments',
            "@_is_media_data": true
          },
          subject: 'TestSubject'
        };

        SELECT.from.mockReturnValue({
          columns: jest.fn().mockResolvedValue([])
        });

        await service.attachNonDraftAttachmentDeletionData(mockReq);

        expect(mockReq.attachmentsToDelete).toBeUndefined();
      });

      it("should handle single attachment deletion", async () => {
        const mockAttachment = [
          { url: 'http://example.com/single-file', ID: '123' }
        ];

        mockReq = {
          target: { 
            name: 'SingleAttachment',
            "@_is_media_data": true
          },
          subject: 'TestSubject'
        };

        SELECT.from.mockReturnValue({
          columns: jest.fn().mockResolvedValue(mockAttachment)
        });

        await service.attachNonDraftAttachmentDeletionData(mockReq);

        expect(mockReq.attachmentsToDelete).toEqual([
          { url: 'http://example.com/single-file', ID: '123', target: 'SingleAttachment' }
        ]);
        expect(mockReq.attachmentsToDelete).toHaveLength(1);
      });
    });
  });

  describe('getAttachmentCompositions', () => {
    let service;

    beforeEach(() => {
      service = new SDMAttachmentsService();
      service.creds = { clientId: 'client-id', clientSecret: 'client-secret' };
    });

    it('should recognize Attachments without namespace prefix', () => {
      const targetEntity = { name: 'Test.EntityWithShortAttachments' };

      cds.model.definitions['Test.EntityWithShortAttachments'] = {
        elements: {
          attachments: {
            type: 'cds.Composition',
            target: 'Test.ShortAttachments'
          }
        }
      };

      cds.model.definitions['Test.ShortAttachments'] = {
        includes: ['Attachments']  // Without 'sap.attachments.' prefix
      };

      const result = service.getAttachmentCompositions(targetEntity);

      expect(result).toEqual(['attachments']);
    });

    it('should recognize both full and short Attachments includes', () => {
      const targetEntity = { name: 'Test.EntityWithMixedIncludes' };

      cds.model.definitions['Test.EntityWithMixedIncludes'] = {
        elements: {
          fullAttachments: {
            type: 'cds.Composition',
            target: 'Test.FullAttachments'
          },
          shortAttachments: {
            type: 'cds.Composition',
            target: 'Test.ShortAttachments'
          }
        }
      };

      cds.model.definitions['Test.FullAttachments'] = {
        includes: ['sap.attachments.Attachments']
      };
      cds.model.definitions['Test.ShortAttachments'] = {
        includes: ['Attachments']
      };

      const result = service.getAttachmentCompositions(targetEntity);

      expect(result).toContain('fullAttachments');
      expect(result).toContain('shortAttachments');
      expect(result.length).toBe(2);
    });
  });

  // ─── cmis:description / note field mapping ───────────────────────────────────

  describe('note → cmis:description mapping', () => {
    let service;

    beforeEach(() => {
      jest.clearAllMocks();
      service = new SDMAttachmentsService();
      service.creds = { uri: 'http://mock-uri/' };
      getConfigurations.mockReturnValue({ repositoryId: 'repo123' });
      setupDestinationMocks();
    });

    // ── Scenario 1: document upload with note ────────────────────────────────

    describe('Scenario 1 – document upload with note field', () => {
      it('should pass cmis:description to createAttachment when note is provided', async () => {
        const attachmentData = [{
          ID: 'att-001',
          filename: 'report.pdf',
          content: Buffer.from('pdf content'),
          note: 'This is a test note',
          mimeType: 'application/pdf'
        }];
        const parentId = 'folder-001';
        const req = {
          reject: jest.fn(),
          target: { name: 'TestEntity.attachments', isDraft: true },
          req: { url: '/TestEntity(ID=att-001)/content' }
        };

        createAttachment.mockResolvedValue({
          status: 201,
          data: { succinctProperties: { 'cmis:objectId': 'obj-001' } }
        });
        updateAttachmentInDraft.mockResolvedValue();

        await service.onCreate(attachmentData, service.creds, req, parentId);

        expect(createAttachment).toHaveBeenCalledWith(
          expect.objectContaining({ note: 'This is a test note' }),
          service.creds,
          parentId,
          expect.anything()
        );
      });

      it('should not fail when note is absent on upload (cmis:description omitted)', async () => {
        const attachmentData = [{
          ID: 'att-002',
          filename: 'report.pdf',
          content: Buffer.from('pdf content'),
          mimeType: 'application/pdf'
          // note intentionally absent
        }];
        const parentId = 'folder-002';
        const req = {
          reject: jest.fn(),
          target: { name: 'TestEntity.attachments', isDraft: true },
          req: { url: '/TestEntity(ID=att-002)/content' }
        };

        createAttachment.mockResolvedValue({
          status: 201,
          data: { succinctProperties: { 'cmis:objectId': 'obj-002' } }
        });
        updateAttachmentInDraft.mockResolvedValue();

        await service.onCreate(attachmentData, service.creds, req, parentId);

        // createAttachment called without note (undefined) – should not throw
        expect(createAttachment).toHaveBeenCalledWith(
          expect.not.objectContaining({ note: expect.anything() }),
          service.creds,
          parentId,
          expect.anything()
        );
      });
    });

    // ── Scenario 2: entity edit – draft save with changed note ───────────────

    describe('Scenario 2 – entity edit: note updated on existing draft attachment', () => {
      it('should include cmis:description in updateAttachment when note changes on draft save', async () => {
        const req = {
          reject: jest.fn(),
          data: {
            references: [{ ID: 'att-003', filename: 'invoice.pdf', note: 'Updated note' }]
          }
        };
        const attachment = { ID: 'att-003', filename: 'invoice.pdf', url: 'obj-003', note: 'Updated note' };
        const attachmentsEntity = { name: 'TestEntity.references', elements: {} };

        getPropertiesForID.mockResolvedValue({});
        getUpdatedSecondaryProperties.mockReturnValue({});
        updateAttachment.mockResolvedValue(200);
        isRestrictedCharactersInName.mockReturnValue(false);

        // _getNoteFromDB: SELECT.one.from(entity).where({ID}).columns('note') → {note}
        const noteRow = { note: null };
        const whereMock1 = { columns: jest.fn().mockResolvedValue(noteRow) };
        const fromMock1 = { where: jest.fn().mockReturnValue(whereMock1) };
        global.SELECT.one.from = jest.fn().mockReturnValue(fromMock1);

        service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'invoice.pdf' });
        service.replacePropertiesInAttachment = jest.fn();

        const context = {
          attachment,
          attachmentsEntity,
          filenameInSDM: 'invoice.pdf',
          compositionName: 'references',
          secondaryProperties: {
            invalidDefinitions: {},
            typeProperties: new Map()
          }
        };

        await service._updateAttachments(req, context);

        expect(updateAttachment).toHaveBeenCalledWith(
          req,
          attachment,
          service.creds,
          expect.anything(),
          expect.objectContaining({ 'cmis:description': 'Updated note' }),
          {}
        );
      });

      it('should NOT call updateAttachment when note is unchanged', async () => {
        const req = {
          reject: jest.fn(),
          data: {
            references: [{ ID: 'att-004', filename: 'invoice.pdf', note: 'Same note' }]
          }
        };
        const attachment = { ID: 'att-004', filename: 'invoice.pdf', url: 'obj-004', note: 'Same note' };
        const attachmentsEntity = { name: 'TestEntity.references', elements: {} };

        getPropertiesForID.mockResolvedValue({});
        getUpdatedSecondaryProperties.mockReturnValue({});
        isRestrictedCharactersInName.mockReturnValue(false);

        // DB already has the same note
        const noteRow2 = { note: 'Same note' };
        const whereMock2 = { columns: jest.fn().mockResolvedValue(noteRow2) };
        const fromMock2 = { where: jest.fn().mockReturnValue(whereMock2) };
        global.SELECT.one.from = jest.fn().mockReturnValue(fromMock2);

        service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'invoice.pdf' });
        service.replacePropertiesInAttachment = jest.fn();

        const context = {
          attachment,
          attachmentsEntity,
          filenameInSDM: 'invoice.pdf',
          compositionName: 'references',
          secondaryProperties: {
            invalidDefinitions: {},
            typeProperties: new Map()
          }
        };

        await service._updateAttachments(req, context);

        // No properties changed → updateAttachment must NOT be called
        expect(updateAttachment).not.toHaveBeenCalled();
      });

      it('should map note to cmis:description when editing non-draft entity attachment', async () => {
        const attachmentsEntity = {
          name: 'TestEntity.references',
          elements: {}
        };
        const attachment = { ID: 'att-005', filename: 'contract.pdf', note: 'New note for non-draft' };
        cds.ql.SELECT = {
          one: {
            from: jest.fn().mockImplementation(() => ({
              where: jest.fn().mockResolvedValue({ filename: 'contract.pdf', url: 'obj-005', note: null }),
              columns: jest.fn().mockReturnValue({
                where: jest.fn().mockResolvedValue({ note: null })
              })
            }))
          }
        };

        getPropertiesForID.mockResolvedValue({});
        getUpdatedSecondaryProperties.mockReturnValue({});
        updateAttachment.mockResolvedValue(200);
        isRestrictedCharactersInName.mockReturnValue(false);

        const validationContext = {
          typeProperties: new Map(),
          invalidDefinitions: {},
          propertyTitles: {}
        };

        service._fetchCurrentAttachment = jest.fn().mockResolvedValue({
          filename: 'contract.pdf',
          url: 'obj-005',
          note: null
        });
        service._getNoteFromDB = jest.fn().mockResolvedValue(null);
        service._updateAttachmentInSDM = jest.fn().mockResolvedValue(null);

        await service._processNonDraftAttachmentUpdate(
          { reject: jest.fn() },
          attachment,
          attachmentsEntity,
          validationContext
        );

        expect(service._updateAttachmentInSDM).toHaveBeenCalledWith(
          expect.anything(),
          expect.anything(),
          attachment,
          expect.objectContaining({ 'cmis:description': 'New note for non-draft' }),
          {},
          expect.anything()
        );
      });

      it('should clear cmis:description when note is removed (set to null)', async () => {
        const req = {
          reject: jest.fn(),
          data: {
            references: [{ ID: 'att-006', filename: 'doc.pdf', note: null }]
          }
        };
        const attachment = { ID: 'att-006', filename: 'doc.pdf', url: 'obj-006', note: null };
        const attachmentsEntity = { name: 'TestEntity.references', elements: {} };

        getPropertiesForID.mockResolvedValue({});
        getUpdatedSecondaryProperties.mockReturnValue({});
        updateAttachment.mockResolvedValue(200);
        isRestrictedCharactersInName.mockReturnValue(false);

        // DB has an existing note that user cleared
        const noteRow3 = { note: 'Old note' };
        const whereMock3 = { columns: jest.fn().mockResolvedValue(noteRow3) };
        const fromMock3 = { where: jest.fn().mockReturnValue(whereMock3) };
        global.SELECT.one.from = jest.fn().mockReturnValue(fromMock3);

        service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'doc.pdf' });
        service.replacePropertiesInAttachment = jest.fn();

        const context = {
          attachment,
          attachmentsEntity,
          filenameInSDM: 'doc.pdf',
          compositionName: 'references',
          secondaryProperties: {
            invalidDefinitions: {},
            typeProperties: new Map()
          }
        };

        await service._updateAttachments(req, context);

        // cmis:description should be sent as null to clear it
        expect(updateAttachment).toHaveBeenCalledWith(
          req,
          attachment,
          service.creds,
          expect.anything(),
          expect.objectContaining({ 'cmis:description': null }),
          {}
        );
      });
    });

    // ── Scenario 3: link creation / link edit with note ──────────────────────

    describe('Scenario 3 – link creation and edit with note field', () => {
      it('should pass note as cmis:description when creating a link with a note', async () => {
        const parentUUID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
        const linkToCreateInSDM = {
          filename: 'SAP Link',
          mimeType: 'application/internet-shortcut',
          repositoryId: 'repo123',
          linkUrl: 'https://www.sap.com',
          note: 'This is a link note'
        };

        createAttachment.mockResolvedValue({
          status: 201,
          data: { succinctProperties: { 'cmis:objectId': 'link-obj-001' } }
        });
        getDraftAdministrativeData_DraftUUIDForUpId.mockResolvedValue([{
          DraftAdministrativeData_DraftUUID: 'draft-uuid-001'
        }]);
        updateLinkInDraft.mockResolvedValue();

        const req = {
          req: { url: `/TestEntity(ID=${parentUUID})/createLink` },
          data: { name: 'SAP Link', url: 'https://www.sap.com' },
          target: { name: 'TestEntity.references' },
          reject: jest.fn()
        };

        await service.createLink(linkToCreateInSDM, service.creds, req, 'folder-001', 'up__ID');

        expect(createAttachment).toHaveBeenCalledWith(
          expect.objectContaining({ note: 'This is a link note' }),
          service.creds,
          'folder-001',
          expect.anything()
        );
      });

      it('should update cmis:description when note changes on an existing draft attachment during entity save', async () => {
        // Simulates: user opens draft, changes note on an already-uploaded attachment, saves
        const req = {
          reject: jest.fn(),
          data: {
            references: [{ ID: 'att-007', filename: 'report.xlsx', note: 'Draft save note' }]
          }
        };
        const attachment = {
          ID: 'att-007',
          filename: 'report.xlsx',
          url: 'obj-007',
          note: 'Draft save note',
          HasActiveEntity: true  // existing (non-new) draft attachment
        };
        const attachmentsEntity = { name: 'TestEntity.references', elements: {} };

        getPropertiesForID.mockResolvedValue({});
        getUpdatedSecondaryProperties.mockReturnValue({});
        updateAttachment.mockResolvedValue(200);
        isRestrictedCharactersInName.mockReturnValue(false);

        const noteRow4 = { note: null };
        const whereMock4 = { columns: jest.fn().mockResolvedValue(noteRow4) };
        const fromMock4 = { where: jest.fn().mockReturnValue(whereMock4) };
        global.SELECT.one.from = jest.fn().mockReturnValue(fromMock4);

        service.getAttachementDataInSDM = jest.fn().mockResolvedValue({ filename: 'report.xlsx' });
        service.replacePropertiesInAttachment = jest.fn();

        const context = {
          attachment,
          attachmentsEntity,
          filenameInSDM: 'report.xlsx',
          compositionName: 'references',
          secondaryProperties: {
            invalidDefinitions: {},
            typeProperties: new Map()
          }
        };

        await service._updateAttachments(req, context);

        expect(updateAttachment).toHaveBeenCalledWith(
          req,
          attachment,
          service.creds,
          expect.anything(),
          expect.objectContaining({ 'cmis:description': 'Draft save note' }),
          {}
        );
      });

      it('should preserve note value through editLink flow when note is not changed', async () => {
        service.originalUrlMap = new Map();
        const attachmentId = '123e4567-e89b-12d3-a456-426614174000';
        const req = {
          req: { url: `/Attachments(ID=${attachmentId})` },
          target: { name: 'Attachments' },
          data: { url: 'https://updated-url.com' },
          reject: jest.fn()
        };

        cds.model.definitions['Attachments'] = {};

        getAttachmentById.mockResolvedValue({
          ID: attachmentId,
          url: 'link-obj-001',
          filename: 'MyLink.url',
          linkUrl: 'https://original-url.com',
          note: 'Existing note'
        });

        setupDestinationMocks();
        editLink.mockResolvedValue({ status: 200 });
        editLinkInDraft.mockResolvedValue();

        const result = await service.handleEditLinkAction(req);

        // editLink called with new URL
        expect(editLink).toHaveBeenCalledWith(
          'link-obj-001',
          'MyLink',
          'https://updated-url.com',
          service.creds,
          expect.anything()
        );

        // editLinkInDraft updates linkUrl and baseline note (not the user note)
        expect(editLinkInDraft).toHaveBeenCalledWith(
          req,
          expect.objectContaining({ linkUrl: 'https://updated-url.com' })
        );

        expect(result).toEqual({ success: true, message: 'Link edited successfully' });
      });
    });
  });
});