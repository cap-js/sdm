const axios = require('axios');
const credentials = require('./credentials.json');
const API = require('./api');

let token;
let incidentID;
let appUrl = credentials.appUrl
let serviceName = 'processor';
let entityName = 'Incidents';
let srvpath = 'ProcessorService';
let attachments = []
let incidentToDelete;
let incidentToDelete_empty;

beforeAll(async () => {
  authRes = await axios.get(
    `${credentials.authUrl}/oauth/token?grant_type=password&username=${credentials.username}&password=${credentials.password}`,
    {
      auth: {
        username: credentials.clientID,
        password: credentials.clientSecret
      }
    }
  );
  token = authRes.data.access_token;
  config = {
    headers: { 'Authorization': "Bearer " + token }
  };
  api = new API(config);
});

describe('Attachments Integration Tests --CREATE', () => {
  //When an attachment is created, the function also attempts to read it from drafts. If this attempt fails, an error is thrown and the attachment is not created.
  it('should create an entity and check if it has been created', async () => { 
    let response = await api.createEntity(appUrl, serviceName, entityName, srvpath);
    incidentID = response.incidentID;
    incidentToDelete_empty = incidentID;
    expect(response.status).toBe("OK");
    expect(response.incidentID).toBeDefined();
  });   

  it('should upload a single attachment and check if it has been uploaded with content --pdf', async () => { 
    const files = [
      { 
        filename: "sample.pdf", 
        filepath: "./test/integration/sample.pdf" 
      }
    ]

    const postData = {
      up__ID: incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    const response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, srvpath, postData, files);
    for(let i = 0; i < files.length; i++){
      expect(response.status[i]).toBe("OK")
      attachments.push(response.attachmentID[i])
    }
  });

  it('should upload a single attachment and check if it has been uploaded with content --exe', async () => { 
    //A separate test case is formed for exe as the postData will vary, and unlike pdf it can't be viewed in browser
    const files = [
      { 
        filename: "sample.exe", 
        filepath: "./test/integration/sample.exe" 
      }
    ]

    const postData = {
      up__ID: incidentID,
      mimeType: "application/exe",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    const response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, srvpath, postData, files);
    for(let i = 0; i < files.length; i++){
      expect(response.status[i]).toBe("OK")
      attachments.push(response.attachmentID[i])
    }
  });

  it('should batch upload', async () => {
    //It should upload multiple attachments (varying size) and check if it has been uploaded with content. One invalid file in the batch will fail 
    const files = [
      { 
        filename: "sample1.pdf", 
        filepath: "./test/integration/sample1.pdf" 
      },
      { 
        filename: "samplebig.pdf", 
        filepath: "./test/integration/samplebig.pdf" 
      },
      { 
        filename: "invalid.pdf", 
        filepath: "./test/integration/invalid.pdf" 
      }
    ];

    const postData = {
      up__ID: incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    const response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, srvpath, postData, files);
    for(let i = 0; i < files.length; i++){
      if(i==2){
        expect(response.status[i]).toBe("An error occured. Attachment not found") //As the invalid.pdf is never saved, the read fails
      }
      else{
        expect(response.status[i]).toBe("OK")
        attachments.push(response.attachmentID[i])
      }
    }
      
    
  });

  it('should not allow upload of duplicate files in same entity', async () => { 
    const files = [
      { 
        filename: "sample.pdf", 
        filepath: "./test/integration/sample.pdf" 
      }
    ]

    const postData = {
      up__ID: incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    const response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, srvpath, postData, files);
    for(let i = 0; i < files.length; i++){
      expect(response.status[i]).toBe("An error occured. Attachment not found") //As the error comes from the plugin itself and not the DI, none of the api calls will fail
    }
  });

  it('should not allow upload of duplicate files in same entity --draft', async () => { 
    const files = [
      { 
        filename: "sample2.pdf", 
        filepath: "./test/integration/sample2.pdf" 
      },
      {
        filename: "sample2.pdf", 
        filepath: "./test/integration/sample2.pdf" 
      }
    ]

    const postData = {
      up__ID: incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    const response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, srvpath, postData, files);
    expect(response).toBe("An error occured") //Fails in draftActivate call
  });

  it('should allow upload of a duplicate file in a different entity', async () => { 
    let response = await api.createEntity(appUrl, serviceName, entityName, srvpath);
    expect(response.status).toBe("OK");
    expect(response.incidentID).toBeDefined();
    incidentToDelete = response.incidentID;

    const files = [
      { 
        filename: "sample.pdf", 
        filepath: "./test/integration/sample.pdf" 
      }
    ]

    const postData = {
      up__ID: response.incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    response = await api.createAttachment(appUrl, serviceName, entityName, response.incidentID, srvpath, postData, files);
    for(let i = 0; i < files.length; i++){
      expect(response.status[i]).toBe("OK")
    }
  });
});

describe('Attachments Integration Tests --READ', () => {
  it('should read the created attachment', async () => {
    //This test case also reads files not supported by browser (.exe)
    const response = await api.readAttachment(appUrl, serviceName, entityName, incidentID, attachments);
    for(let i = 0; i < attachments.length; i++){
      expect(response[i]).toBe("OK")
    }
  });

  it('should not read an attachment that doesnt exist', async () => {
    invalidAttachment = ['invalid-attachment-id']
    const response = await api.readAttachment(appUrl, serviceName, entityName, incidentID, invalidAttachment);
    for(let i = 0; i < 1; i++){
      expect(response[i]).toBe("An error occured. Attachment not found")
    }
  });
});

describe('Attachments Integration Tests --DELETE', () => {
  it('should handle errors in batch delete request', async () => {
    //This test case makes sure the files which are deleted don't exist and vice-versa
    const response = await api.deleteAttachmentNeg(appUrl, serviceName, entityName, incidentID, srvpath, attachments);
    for(let i = 0; i < attachments.length; i++){
      if(i>1){
        expect(response[i]).toBe("OK")
      }
      else{
        expect(response[i]).toBe("An error occured. Attachment not found")
      }
    }
  });
  it('should delete the attachments of an entity', async () => {
    //This test case also performs a read operation to make sure the attachment has been deleted
    const response = await api.deleteAttachment(appUrl, serviceName, entityName, incidentID, srvpath, [attachments[2],attachments[3]]);
    for(let i = 0; i < 2; i++){
      expect(response[i]).toBe("An error occured. Attachment not found")
    }
  });

  it('should delete an attachment that doesnt exist in repository', async () => {
    const response = await api.deleteAttachment(appUrl, serviceName, entityName, incidentToDelete, srvpath, ['invalid_attachment']);
    for(let i = 0; i < 1; i++){
      expect(response[i]).toBe("An error occured. Attachment not found")
    }
  });

  it('should delete an entity and all its attachments', async () => {
    const response = await api.deleteEntity(appUrl, serviceName, entityName, incidentToDelete);
    expect(response).toBe("OK")
  });

  it('should delete an entity after all its attachments have been deleted', async () => {
    const response = await api.deleteEntity(appUrl, serviceName, entityName, incidentToDelete_empty);
    expect(response).toBe("OK")
  });
});



