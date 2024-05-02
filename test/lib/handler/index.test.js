const axios = require('axios');
const {getConfigurations} = require('../../../lib/util/index'); 
const {readAttachment,readDocument} = require('../../../lib/handler/index'); 

jest.mock('axios');
jest.mock('../../../lib/util/index'); 


describe('ReadAttachment function', () => {
  it('returns document on successful read', async () => {
    const mockKey = '123';
    const mockToken = 'a1b2c3';
    const mockCredentials = {uri: 'http://example.com/'};
    const mockRepositoryId = '456';

    const mockResponse = {data: 'mock pdf file content'};
    const mockBuffer = Buffer.from(mockResponse.data, 'binary');
    
    axios.get.mockResolvedValue(mockResponse);
    getConfigurations.mockReturnValue({repositoryId: mockRepositoryId});
    
    const document = await readAttachment(mockKey, mockToken, mockCredentials);

    const expectedUrl = mockCredentials.uri+ "browser/" + mockRepositoryId + "/root?objectID=" + mockKey + "&cmisselector=content";
    expect(axios.get).toHaveBeenCalledWith(expectedUrl, {
      headers: {Authorization: `Bearer ${mockToken}`},
      responseType: 'arraybuffer'
    });
    expect(document).toEqual(mockBuffer);
  });

  it('throws error on unsuccessful read', async () => {
    axios.get.mockImplementationOnce(() => Promise.reject({
      response: {
        statusText: 'something bad happened'
      }
    }));
    
    await expect(readAttachment('123', 'a1b2c3', {uri: 'http://example.com/'})).rejects.toThrow('something bad happened');
  });
});

describe('readDocument function', () => {
  it('returns a document successfully', async () => {
    const mockKey = '123';
    const mockToken = 'a1b2c3';
    const mockUri = 'http://example.com/';
    const mockRepositoryId = '456';

    const mockResponse = {data: 'mock pdf file content'};
    const mockBuffer = Buffer.from(mockResponse.data, 'binary');
    
    axios.get.mockResolvedValue(mockResponse);
    getConfigurations.mockReturnValue({ repositoryId: mockRepositoryId });
   
    const document = await readDocument(mockKey, mockToken, mockUri);

    const expectedUrl = mockUri+ "browser/" + mockRepositoryId + "/root?objectID=" + mockKey + "&cmisselector=content";
    expect(axios.get).toHaveBeenCalledWith(expectedUrl, {
      headers: { Authorization: `Bearer ${mockToken}` },
      responseType: 'arraybuffer'
    });
    expect(document).toEqual(mockBuffer);
  });

  it('throws error when an error occurrs in axios', async () => {
    axios.get.mockImplementationOnce(() => Promise.reject({
      response: {
        statusText: 'something bad happened'
      }
    }));
    
    await expect(readDocument('123', 'a1b2c3', 'http://example.com/')).rejects.toThrow('something bad happened');
  });

  it('throws "An Error Occurred" when an error does not contain response.statusText', async () => {
    // Mock reject error without response.statusText
    axios.get.mockImplementationOnce(() => Promise.reject(new Error()));
    
    await expect(readDocument('123', 'a1b2c3', 'http://example.com/')).rejects.toThrow('An Error Occurred');
  });
});