// Mock the modules before importing them
jest.mock('@sap/cds/lib', () => ({
    connect: {
      to: jest.fn()
    }
  }));
  jest.mock('../../../lib/config');
  jest.mock('../../../lib/util');
  jest.mock('../../../lib/converters/cmis-document-to-odata-entity');
  
  // Now import the modules after mocking them
  const { onCreate } = require('../../../lib/handlers');
  const { getConfigurations } = require('../../../lib/config');
  const { loadDestination } = require('../../../lib/util');
  const convertCMISDocumentToOData = require('../../../lib/converters/cmis-document-to-odata-entity');
  const cds = require('@sap/cds/lib');
  
  describe('onCreate function', () => {
    beforeEach(() => {
      // Mock the getConfigurations and loadDestination functions
      getConfigurations.mockClear();
      loadDestination.mockClear();
      cds.connect.to.mockClear();
    });
  
    it('should handle create operations for folder', async () => {
      // Mock the getConfigurations function to return repositoryId
      getConfigurations.mockReturnValue({ repositoryId: 'mockedRepositoryId' });
  
      // Mock the loadDestination function to return a mocked destination
      loadDestination.mockResolvedValue({ mockedDestination: 'mockedDestination' });
  
      // Mock the createFolder method of srv object
      const createFolderMock = jest.fn().mockResolvedValue({ mockedResult: 'mockedResult' });
      const srvMock = { createFolder: createFolderMock };
      cds.connect.to.mockResolvedValue(srvMock);
  
      // Mock the request object
      const req = {
        reqParams: {
          'cmis:objectTypeId': 'mockedObjectTypeId',
          'cmis:name': 'mockedFolderName',
          'cmis:objectId': 'mockedObjectId',
          'cmis:description': 'mockedDescription'
        },
        data: {} // Assuming content is not required for folder creation
      };
  
      // Call the onCreate function
      const result = await onCreate(req);
  
      // Assert the result
      expect(result).toEqual({ mockedResult: 'mockedResult' });
  
      // Assert that getConfigurations and loadDestination were called
      expect(getConfigurations).toHaveBeenCalled();
      expect(loadDestination).toHaveBeenCalled();
  
      // Assert that createFolder method of srv object was called with correct arguments
      expect(createFolderMock).toHaveBeenCalledWith('mockedRepositoryId', 'mockedFolderName', 'mockedObjectId', 'mockedDescription');
    });
  
    it('should handle create operations for document', async () => {
      // Mock the getConfigurations function to return repositoryId
      getConfigurations.mockReturnValue({ repositoryId: 'mockedRepositoryId' });
  
      // Mock the loadDestination function to return a mocked destination
      loadDestination.mockResolvedValue({ mockedDestination: 'mockedDestination' });
  
      // Mock the createDocument method of srv object
      const createDocumentMock = jest.fn().mockResolvedValue({ mockedResult: 'mockedResult' });
      const srvMock = { createDocument: createDocumentMock };
      cds.connect.to.mockResolvedValue(srvMock);
  
      // Mock the request object
      const req = {
        reqParams: {
          'cmis:objectTypeId': 'cmis:document',
          'cmis:name': 'mockedDocumentName',
          'cmis:objectId': 'mockedObjectId',
          'cmis:description': 'mockedDescription'
        },
        data: { content: 'mockedContent' }
      };
  
      // Call the onCreate function
      const result = await onCreate(req);
  
      // Assert the result
      expect(result).toEqual({ mockedResult: 'mockedResult' });
  
      // Assert that getConfigurations and loadDestination were called
      expect(getConfigurations).toHaveBeenCalled();
      expect(loadDestination).toHaveBeenCalled();
  
      // Assert that createDocument method of srv object was called with correct arguments
      expect(createDocumentMock).toHaveBeenCalledWith('mockedRepositoryId', 'mockedDocumentName', 'mockedObjectId', 'mockedDescription', 'mockedContent');
    });
  
    // Add more test cases to cover other scenarios
  });
  