const axios = require('axios');
const credentials = require('./credentials.json');
const Api = require('./api');
const expect = require('@sap/cds/lib/test/expect');

let token;
let incidentID;
let appUrl = credentials.appUrl
let serviceName = 'processor';
let entityName = 'Incidents';
let srvpath = 'ProcessorService';
let attachments = []
let incidentToDelete;
let incidentIDCustomProperty1;
let incidentIDCustomProperty2;

beforeAll(async () => {
  const authRes = await axios.get(
    `${credentials.authUrl}/oauth/token?grant_type=password&username=${credentials.username}&password=${credentials.password}`,
    {
      auth: {
        username: credentials.clientID,
        password: credentials.clientSecret
      }
    }
  );
  token = authRes.data.access_token;
  const config = {
    headers: { 'Authorization': "Bearer " + token }
  };
  api = new Api(config);
});

describe('Attachments Integration Tests --CREATE', () => {
  //When an attachment is created, the function also attempts to read it from drafts. If this attempt fails, an error is thrown and the attachment is not created.
  it('should create an entity and check if it has been created', async () => { 
    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    incidentID = response.incidentID;
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });   

  it('should upload a single attachment and check if it has been uploaded with content --pdf', async () => { 
    const file = 
    { 
      filename: "sample.pdf", 
      filepath: "./test/integration/sample.pdf" 
    }

    const postData = {
      up__ID: incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    let response = await api.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, postData, file);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    attachments.push(response.ID);
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should upload a single attachment and check if it has been uploaded with content --exe', async () => { 
    //A separate test case is formed for exe as the postData will vary, and unlike pdf it can't be viewed in browser
    const file =
    { 
      filename: "sample.exe", 
      filepath: "./test/integration/sample.exe" 
    }
    
    const postData = {
      up__ID: incidentID,
      mimeType: "application/exe",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    let response = await api.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, postData, file);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    attachments.push(response.ID);
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should not allow upload of duplicate files in same entity', async () => { 
    const file = 
      { 
        filename: "sample.pdf", 
        filepath: "./test/integration/sample.pdf" 
      }

    const postData = {
      up__ID: incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    let response = await api.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, postData, file);
    if (response.status == "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.deleteAttachment(appUrl, serviceName, incidentID, response.ID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
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

    let response = await api.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, postData, files[0]);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.createAttachment(appUrl, serviceName, entityName, incidentID, postData, files[1]);
    if (response.status == "OK") {
      throw new Error("Error : " + "Duplicate attachment was created")
    }
    response = await api.deleteAttachment(appUrl, serviceName, incidentID, response.ID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should allow upload of a duplicate file in a different entity', async () => { 
    let response = await api.createEntityDraft(appUrl, serviceName, entityName, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    incidentToDelete = response.incidentID;

    const file = 
    { 
      filename: "sample.pdf", 
      filepath: "./test/integration/sample.pdf" 
    }

    const postData = {
      up__ID: response.incidentID,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    };

    response = await api.createAttachment(appUrl, serviceName, entityName, incidentToDelete, postData, file);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentToDelete);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });
});

describe('Attachments Integration Tests --READ', () => {
  it('should read the created attachment', async () => {
    //This test case also reads files not supported by browser (.exe)
    for(let i = 0; i < attachments.length; i++){
      const response = await api.readAttachment(appUrl, serviceName, entityName, incidentID, attachments[i]);
      if (response.status !== "OK") {
        throw new Error("Error : " + response.message)
      }
    }
  });

  it('should not read an attachment that doesnt exist', async () => {
    const invalidAttachment = 'invalid-attachment-id';
    const response = await api.readAttachment(appUrl, serviceName, entityName, incidentID, invalidAttachment);
    if (response.status == "OK") {
      throw new Error("Error : " + response.message)
    }
  });
});

describe('Attachments Integration Tests --UPDATE', () => {
  let attachment1;
  let attachment2;
  let attachment3;

  it('should update valid properties of attachments during create of entity', async () => {
    let response = await api.createEntityDraft(appUrl, serviceName, entityName, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    incidentIDCustomProperty1 = response.incidentID;

    const postData = {
      up__ID: incidentIDCustomProperty1,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    }

    const file = 
    { 
      filename: "sample.pdf", 
      filepath: "./test/integration/sample.pdf" 
    }    

    response = await api.createAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty1, postData, file);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    attachment1 = response.ID;

    let updateData = {
      filename : "sample_updated.pdf",
      customProperty1_code: "test",
      customProperty2: 100,
      customProperty5: "2025-03-24T05:20:07Z",
      customProperty6: true
    }
    response = await api.updateAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty1, updateData, attachment1);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentIDCustomProperty1);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.fetchMetadata(appUrl, serviceName, entityName, incidentIDCustomProperty1, attachment1);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe("sample_updated.pdf");
    expect(response.data.customProperty1_code).toBe("test");
    expect(response.data.customProperty2).toBe(100);
    expect(response.data.customProperty5).toBe("2025-03-24T05:20:07Z");
    expect(response.data.customProperty6).toBe(true);
  });

  it('should update valid properties of attachments after save of entity', async () => {
    let response = await api.editEntity(appUrl, serviceName, entityName, incidentIDCustomProperty1, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    
    let updateData = {
      filename : "sample_updated1.pdf",
      customProperty1_code: "test123",
      customProperty2: 123,
      customProperty5: "2026-03-24T05:20:07Z",
      customProperty6: false
    }
    response = await api.updateAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty1, updateData, attachment1);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentIDCustomProperty1);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.fetchMetadata(appUrl, serviceName, entityName, incidentIDCustomProperty1, attachment1);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe("sample_updated1.pdf");
    expect(response.data.customProperty1_code).toBe("test123");
    expect(response.data.customProperty2).toBe(123);
    expect(response.data.customProperty5).toBe("2026-03-24T05:20:07Z");
    expect(response.data.customProperty6).toBe(false);
  });

  it('should not update invalid properties of attachments and should update valid properties during create of entity', async () => {
    let response = await api.createEntityDraft(appUrl, serviceName, entityName, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    incidentIDCustomProperty2 = response.incidentID;

    const postData = {
      up__ID: incidentIDCustomProperty2,
      mimeType: "application/pdf",
      createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
      createdBy: "test@test.com",
      modifiedBy: "test@test.com"
    }

    const files = [
      { 
        filename: "sample.pdf", 
        filepath: "./test/integration/sample.pdf" 
      },
      {
        filename: "sample2.pdf", 
        filepath: "./test/integration/sample2.pdf" 
      } 
    ]
       

    response = await api.createAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty2, postData, files[0]);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    attachment2 = response.ID;
    response = await api.createAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty2, postData, files[1]);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    attachment3 = response.ID;

    let updateDataInvalid = {
      filename : "sample_updated_invalid.pdf",
      customProperty1_code: "test",
      customProperty2: 100,
      customProperty5: "2025-03-24T05:20:07Z",
      customProperty6: true,
      customProperty3: "invalid value",
      customProperty4: "invalid value"

    }
    let updateDataValid = {
      filename : "sample_updated_valid.pdf",
      customProperty1_code: "test",
      customProperty2: 100,
      customProperty5: "2025-03-24T05:20:07Z",
      customProperty6: true
    }
    response = await api.updateAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty2, updateDataInvalid, attachment2);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.updateAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty2, updateDataValid, attachment3);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentIDCustomProperty2);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    if (response.sapMessages && response.sapMessages.length > 0) {
      expect(response.sapMessages).toBe('[{"code":"500","message":"The following secondary properties are not supported:\\n\\n\\t\\u2022 id1\\n\\t\\u2022 id2\\n\\nPlease contact your administrator for assistance with any necessary adjustments.","numericSeverity":3}]');
    }
    response = await api.fetchMetadata(appUrl, serviceName, entityName, incidentIDCustomProperty2, attachment2);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe("sample.pdf");
    expect(response.data.customProperty1_code).toBe(null);
    expect(response.data.customProperty2).toBe(null);
    expect(response.data.customProperty5).toBe(null);
    expect(response.data.customProperty6).toBe(null);
    response = await api.fetchMetadata(appUrl, serviceName, entityName, incidentIDCustomProperty2, attachment3);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe("sample_updated_valid.pdf");
    expect(response.data.customProperty1_code).toBe("test");
    expect(response.data.customProperty2).toBe(100);
    expect(response.data.customProperty5).toBe("2025-03-24T05:20:07Z");
    expect(response.data.customProperty6).toBe(true);
  });

  it('should not update invalid properties of attachments and should update valid properties after save of entity', async () => {
    let response = await api.editEntity(appUrl, serviceName, entityName, incidentIDCustomProperty2, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    
    let updateDataInvalid = {
      filename : "sample_updated_invalid.pdf",
      customProperty1_code: "test123",
      customProperty2: 123,
      customProperty5: "2026-03-24T05:20:07Z",
      customProperty6: false,
      customProperty3: "invalid value",
      customProperty4: "invalid value"
    }
    let updateDataValid = {
      filename : "sample_updated.pdf",
      customProperty1_code: "test123",
      customProperty2: 123,
      customProperty5: "2026-03-24T05:20:07Z",
      customProperty6: false
    }
    response = await api.updateAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty2, updateDataInvalid, attachment2);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.updateAttachment(appUrl, serviceName, entityName, incidentIDCustomProperty2, updateDataValid, attachment3);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentIDCustomProperty2);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    if (response.sapMessages && response.sapMessages.length > 0) {
      expect(response.sapMessages).toBe('[{"code":"500","message":"The following secondary properties are not supported:\\n\\n\\t\\u2022 id1\\n\\t\\u2022 id2\\n\\nPlease contact your administrator for assistance with any necessary adjustments.","numericSeverity":3}]');
    }
    response = await api.fetchMetadata(appUrl, serviceName, entityName, incidentIDCustomProperty2, attachment2);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe("sample.pdf");
    expect(response.data.customProperty1_code).toBe(null);
    expect(response.data.customProperty2).toBe(null);
    expect(response.data.customProperty5).toBe(null);
    expect(response.data.customProperty6).toBe(null);
    response = await api.fetchMetadata(appUrl, serviceName, entityName, incidentIDCustomProperty2, attachment3);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe("sample_updated.pdf");
    expect(response.data.customProperty1_code).toBe("test123");
    expect(response.data.customProperty2).toBe(123);
    expect(response.data.customProperty5).toBe("2026-03-24T05:20:07Z");
    expect(response.data.customProperty6).toBe(false);
  });
});

describe('Attachments Integration Tests --DELETE', () => {
  it('should delete the attachments of an entity', async () => {
    let response = await api.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.deleteAttachment(appUrl, serviceName, incidentID, attachments[0]);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should delete an entity and all its attachments', async () => {
    let response = await api.deleteEntity(appUrl, serviceName, entityName, incidentToDelete);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.deleteEntity(appUrl, serviceName, entityName, incidentIDCustomProperty1);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.deleteEntity(appUrl, serviceName, entityName, incidentIDCustomProperty2);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should delete an entity after all its attachments have been deleted', async () => {
    const response = await api.deleteEntity(appUrl, serviceName, entityName, incidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });
});



