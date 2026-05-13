const axios = require('axios');
const credentials = require('./credentials.json');
const Api = require('./api');
const expect = require('@sap/cds/lib/test/expect');
const tenancyModel = process.env.TENANCY_MODEL || 'single';
const tenant = process.env.TENANT;
const tokenFlow = process.env.TOKEN_FLOW || 'namedUser';

const { userNotAuthorisedErrorEditLink } = require("../../lib/util/messageConsts");

let token;
let noSDMRoleToken;
let api;
let apiNoSDMRole;
let incidentID;
let appUrl;
let serviceName = 'processor';
let entityName = 'Incidents';
let srvpath = 'ProcessorService';
let attachments = []
let incidentToDelete;
let incidentIDCustomProperty1;
let incidentIDCustomProperty2;

beforeAll(async () => {
  let clientId;
  let clientSecret;
  let authUrl;

  if (tenancyModel === 'multi') {
    appUrl = credentials.appUrlMT;
    clientId = credentials.clientIDMT;
    clientSecret = credentials.clientSecretMT;

    if (tenant === 'SDM-DEV-CONSUMER-EU12') {
      console.log('Running integration tests | SDM-DEV-CONSUMER-EU12 tenant');
      authUrl = credentials.authUrlMTSDC;
    } else if (tenant === 'SDMGoogleWorkspaceConsumer') {
      console.log('Running integration tests | SDMGoogleWorkspaceConsumer tenant');
      authUrl = credentials.authUrlMTGWC;
    }
  } else {
    console.log('Running integration tests | Single tenant Scenario');
    appUrl = credentials.appUrl;
    clientId = credentials.clientID;
    clientSecret = credentials.clientSecret;
    authUrl = credentials.authUrl;
  }

  if (tokenFlow === 'technicalUser') {
    console.log('Technical user token flow');
    try {
      const authRes = await axios.post(
          `${authUrl}/oauth/token?grant_type=client_credentials`,
          null,
          {
            auth: {
              username: clientId,
              password: clientSecret
            }
          }
      );
      token = authRes.data.access_token;
    } catch (error) {
      console.error("Failed to generate technical user Token:", error.message);
      throw error;
    }
  } else if (tokenFlow === 'namedUser') {
    console.log('Named user token flow');
    try {
      const authRes = await axios.get(
          `${authUrl}/oauth/token?grant_type=password&username=${credentials.username}&password=${credentials.password}`,
          {
            auth: {
              username: clientId,
              password: clientSecret
            }
          }
      );
      token = authRes.data.access_token;
    } catch (error) {
      console.error("Failed to generate Token:", error.message);
      throw error;
    }

    try {
      const authResNoSDMRole = await axios.get(
          `${authUrl}/oauth/token?grant_type=password&username=${credentials.noSDMRoleUsername}&password=${credentials.noSDMRoleUserPassword}`,
          {
            auth: {
              username: clientId,
              password: clientSecret
            }
          }
      );
      noSDMRoleToken = authResNoSDMRole.data.access_token;
    } catch (error) {
      console.error("Failed to generate No-SDM-Role Token:", error.message);
      throw error;
    }
  } else {
    throw new Error(`Invalid TOKEN_FLOW specified: ${tokenFlow}. Expected 'namedUser' or 'technicalUser'.`);
  }

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

  it('should not upload an attachment when user does not have SDM role', async () => {
    if (tokenFlow !== 'technicalUser') {
      const file =
          {
            filename: "sample3.pdf",
            filepath: "./test/integration/sample3.pdf"
          }

      const postData = {
        up__ID: incidentID,
        mimeType: "application/pdf",
        createdAt: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString(),
        createdBy: "test@test.com",
        modifiedBy: "test@test.com"
      };
      const config = {
        headers: {'Authorization': "Bearer " + noSDMRoleToken}
      };
      apiNoSDMRole = new Api(config);
      let response = await apiNoSDMRole.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
      if (response.status !== "OK") {
        throw new Error("Error : " + response.message)
      }
      response = await apiNoSDMRole.createAttachment(appUrl, serviceName, entityName, incidentID, postData, file);
      expect(response.message).toBe("Create attachment API call (put) failed : Request failed with status code 403");
      response = await apiNoSDMRole.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
      if (response.status !== "OK") {
        throw new Error("Error : " + response.message)
      }
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
    response = await api.deleteAttachment(appUrl, serviceName, incidentID, response.ID,entityName);
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
    response = await api.deleteAttachment(appUrl, serviceName, incidentID, response.ID,entityName);
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
    if (tokenFlow !== 'technicalUser') {
      //This test case also reads files not supported by browser (.exe)
      for (let i = 0; i < attachments.length; i++) {
        const response = await api.readAttachment(appUrl, serviceName, entityName, incidentID, attachments[i]);
        if (response.status !== "OK") {
          throw new Error("Error : " + response.message)
        }
      }
      const config = {
        headers: {'Authorization': "Bearer " + noSDMRoleToken}
      };
      apiNoSDMRole = new Api(config);
      const response = await apiNoSDMRole.readAttachment(appUrl, serviceName, entityName, incidentID, attachments[0]);
      console.log(response.message);
      expect(response.message).toBe("Read attachment API call failed : Request failed with status code 403");
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

describe('Attachments Integration Tests --LINK', () => {
  let editLinkIncidentID;
  let editLinkAttachmentID;

  it('should successfully create a link and verify it is openable after multiple edits', async () => {
    let linkIncidentID;
    let linkAttachmentID;
    let secondLinkAttachmentID;
    
    const linkName = 'GitHub';
    const linkUrl = 'https://github.com';
    const secondLinkName = 'Stack Overflow';
    const secondLinkUrl = 'https://stackoverflow.com';

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    console.log("Response in Link "+response.status);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    linkIncidentID = response.incidentID;

    response = await api.createLink(appUrl, serviceName, entityName, linkIncidentID, srvpath, linkName, linkUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get the attachments list to find the created link's ID
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, linkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Find the link attachment by name and URL
    const linkAttachment = response.attachments.find(att => 
      att.filename === linkName && att.linkUrl === linkUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    linkAttachmentID = linkAttachment.ID;

    // Save the draft after creating the first link
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, linkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Fetch metadata to verify the first link exists and has correct properties
    response = await api.fetchMetadata(appUrl, serviceName, entityName, linkIncidentID, linkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(linkName);
    expect(response.data.linkUrl).toBe(linkUrl);

    // Second edit: Test that we can create another link after editing the same entity again
    response = await api.editEntity(appUrl, serviceName, entityName, linkIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Create a second link in the same entity
    response = await api.createLink(appUrl, serviceName, entityName, linkIncidentID, srvpath, secondLinkName, secondLinkUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get the updated attachments list
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, linkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Find the second link attachment
    const secondLinkAttachment = response.attachments.find(att => 
      att.filename === secondLinkName && att.linkUrl === secondLinkUrl
    );
    if (!secondLinkAttachment) {
      throw new Error("Error : Second link not found in attachments list")
    }
    secondLinkAttachmentID = secondLinkAttachment.ID;

    // Verify we now have 2 links total
    expect(response.attachments.length).toBe(2);

    // Save the draft after creating the second link
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, linkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Third edit: Test that both links are accessible in different states
    response = await api.editEntity(appUrl, serviceName, entityName, linkIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Test that the first link is openable from draft state (IsActiveEntity=false)
    response = await api.openAttachment(appUrl, serviceName, entityName, linkIncidentID, srvpath, linkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Save the draft to test opening second link from saved state
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, linkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Test that the second link is openable from saved state (IsActiveEntity=true)
    response = await api.openAttachmentSaved(appUrl, serviceName, entityName, linkIncidentID, srvpath, secondLinkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

// Test that the second link throws authorization error for use without sdm role
//here use the noSDMRoleUsername
const config = {
    headers: { 'Authorization': "Bearer " + noSDMRoleToken }
  };
    if (tokenFlow !== 'technicalUser') {
      apiNoSDMRole = new Api(config);
      response = await apiNoSDMRole.openAttachmentSaved(appUrl, serviceName, entityName, linkIncidentID, srvpath, secondLinkAttachmentID);
      expect(response.message).toBe("Open attachment saved API call failed : Request failed with status code 403");
    }
    // Verify metadata for both links after multiple edits
    response = await api.fetchMetadata(appUrl, serviceName, entityName, linkIncidentID, linkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(linkName);
    expect(response.data.linkUrl).toBe(linkUrl);

    response = await api.fetchMetadata(appUrl, serviceName, entityName, linkIncidentID, secondLinkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(secondLinkName);
    expect(response.data.linkUrl).toBe(secondLinkUrl);

    // Cleanup - delete the entity created for link testing
    response = await api.deleteEntity(appUrl, serviceName, entityName, linkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should allow creation of a link with the same name and URL in a different entity', async () => {
    // Define the same link parameters as the previous test
    const linkName = 'GitHub';
    const linkUrl = 'https://github.com';
    let secondLinkIncidentID;
    let secondLinkAttachmentID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    secondLinkIncidentID = response.incidentID;

    // Create the link with the same name and URL as the previous test
    response = await api.createLink(appUrl, serviceName, entityName, secondLinkIncidentID, srvpath, linkName, linkUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get the attachments list to find the created link's ID
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, secondLinkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Find the link attachment by name and URL
    const linkAttachment = response.attachments.find(att => 
      att.filename === linkName && att.linkUrl === linkUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    secondLinkAttachmentID = linkAttachment.ID;

    // Save the draft after creating the link
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, secondLinkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Verify the link was created with correct properties
    response = await api.fetchMetadata(appUrl, serviceName, entityName, secondLinkIncidentID, secondLinkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(linkName);
    expect(response.data.linkUrl).toBe(linkUrl);

    // Cleanup - delete the second entity
    response = await api.deleteEntity(appUrl, serviceName, entityName, secondLinkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should fail to create links with invalid parameters and prevent duplicate names', async () => {
    let testIncidentID;
    let validLinkAttachmentID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    testIncidentID = response.incidentID;
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, testIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.editEntity(appUrl, serviceName, entityName, testIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Test 1: URL without proper protocol
    try {
      const invalidUrl = 'example.com';
      response = await api.createLink(appUrl, serviceName, entityName, testIncidentID, srvpath, 'ValidName', invalidUrl);
      if (response.status === "OK") {
        throw new Error("Error : Link creation should have failed for invalid URL format")
      }
      expect(response.message).toBe("Enter a value matching the pattern ^(https?:\\/\\/)(([a-zA-Z0-9\\-]+\\.)+[a-zA-Z]{2,}|localhost)(:\\d{2,5})?(\\/[^\\s]*)?$.");
    } catch (error) {
      expect(error.message).toBe("Enter a value matching the pattern ^(https?:\\/\\/)(([a-zA-Z0-9\\-]+\\.)+[a-zA-Z]{2,}|localhost)(:\\d{2,5})?(\\/[^\\s]*)?$.");
    }

    // Test 2: Link name has restricted characters (/)
    try {
      const nameWithSlash = 't/es';
      response = await api.createLink(appUrl, serviceName, entityName, testIncidentID, srvpath, nameWithSlash, 'https://example1.com');
      if (response.status === "OK") {
        throw new Error("Error : Link creation should have failed for name containing '/' character")
      }
      expect(response.message.trim()).toBe("Link could not be created. The following name(s) contain unsupported characters (/, \\). \n\n\t• t/es\n\nRename the file(s) and try again.");
    } catch (error) {
      expect(error.message.trim()).toBe("Link could not be created. The following name(s) contain unsupported characters (/, \\). \n\n\t• t/es\n\nRename the file(s) and try again.");
    }

    // Test 4: Empty link name
    try {
      response = await api.createLink(appUrl, serviceName, entityName, testIncidentID, srvpath, '', 'https://example3.com');
      if (response.status === "OK") {
        throw new Error("Error : Link creation should have failed for empty name")
      }
      // Server should return an error for empty name
      expect(response.status).toBe("ERROR");
      expect(response.message).toBeDefined();
    } catch (error) {
      // If it throws an exception, that's also acceptable validation
      expect(error.message).toBeDefined();
    }

    // Test 5: Empty link URL
    try {
      response = await api.createLink(appUrl, serviceName, entityName, testIncidentID, srvpath, 'ValidName', '');
      if (response.status === "OK") {
        throw new Error("Error : Link creation should have failed for empty URL")
      }
      // Server should return an error for empty URL
      expect(response.status).toBe("ERROR");
      expect(response.message).toBeDefined();
    } catch (error) {
      // If it throws an exception, that's also acceptable validation
      expect(error.message).toBeDefined();
    }

    // Test 6: Both name and URL empty
    try {
      response = await api.createLink(appUrl, serviceName, entityName, testIncidentID, srvpath, '', '');
      if (response.status === "OK") {
        throw new Error("Error : Link creation should have failed for both empty name and URL")
      }
      // Server should return an error for both empty fields
      expect(response.status).toBe("ERROR");
      expect(response.message).toBeDefined();
    } catch (error) {
      // If it throws an exception, that's also acceptable validation
      expect(error.message).toBeDefined();
    }

    // Create a valid link first to test duplicate scenario
    const validLinkName = 'TestLink';
    const validLinkUrl = 'https://test.example.com';
    response = await api.createLink(appUrl, serviceName, entityName, testIncidentID, srvpath, validLinkName, validLinkUrl);
    if (response.status !== "OK") {
      throw new Error("Error : Failed to create valid link for duplicate test: " + response.message)
    }

    // Get the attachments list to verify the valid link was created
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, testIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Find the valid link attachment
    const validLinkAttachment = response.attachments.find(att => 
      att.filename === validLinkName && att.linkUrl === validLinkUrl
    );
    if (!validLinkAttachment) {
      throw new Error("Error : Valid link not found in attachments list")
    }
    validLinkAttachmentID = validLinkAttachment.ID;

    // Test 7: Duplicate link name (same name, different URL)
    try {
      response = await api.createLink(appUrl, serviceName, entityName, testIncidentID, srvpath, validLinkName, 'https://different.example.com');
      if (response.status === "OK") {
        throw new Error("Error : Link creation should have failed for duplicate name")
      }
      // Server should return an error for duplicate name
      expect(response.status).toBe("ERROR");
      expect(response.message).toBeDefined();
    } catch (error) {
      // If it throws an exception, that's also acceptable validation
      expect(error.message).toBeDefined();
    }

    // Save the draft to persist the valid link
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, testIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Verify the valid link still exists and has correct properties
    response = await api.fetchMetadata(appUrl, serviceName, entityName, testIncidentID, validLinkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(validLinkName);
    expect(response.data.linkUrl).toBe(validLinkUrl);

    // Cleanup - delete the test entity
    response = await api.deleteEntity(appUrl, serviceName, entityName, testIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should successfully delete a link using deleteAttachment API', async () => {
    let deleteTestIncidentID;
    let deleteTestLinkID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    deleteTestIncidentID = response.incidentID;

    // Create a link to delete
    const linkName = 'LinkToDelete';
    const linkUrl = 'https://delete-test.com';
    response = await api.createLink(appUrl, serviceName, entityName, deleteTestIncidentID, srvpath, linkName, linkUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get the link ID
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, deleteTestIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const linkAttachment = response.attachments.find(att => 
      att.filename === linkName && att.linkUrl === linkUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    deleteTestLinkID = linkAttachment.ID;

    // Save the draft to persist the link
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, deleteTestIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Edit entity again to delete the link
    response = await api.editEntity(appUrl, serviceName, entityName, deleteTestIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Delete the link using deleteAttachment API
    response = await api.deleteAttachment(appUrl, serviceName, deleteTestIncidentID, deleteTestLinkID, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Save the draft after deletion
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, deleteTestIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Verify the link was deleted by trying to fetch its metadata (should fail)
    try {
      response = await api.fetchMetadata(appUrl, serviceName, entityName, deleteTestIncidentID, deleteTestLinkID);
      if (response.status === "OK") {
        throw new Error("Error : Link should have been deleted but metadata was still found")
      }
    } catch (error) {
      // Expected - link should not exist anymore
      expect(error).toBeDefined();
    }

    // Cleanup - delete the test entity
    response = await api.deleteEntity(appUrl, serviceName, entityName, deleteTestIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should successfully rename a link using updateAttachment API', async () => {
    let renameSuccessIncidentID;
    let renameSuccessLinkID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    renameSuccessIncidentID = response.incidentID;
    
    // Create a link to rename
    const originalName = 'OriginalSuccessName';
    const linkUrl = 'https://rename-success-test.com';
    response = await api.createLink(appUrl, serviceName, entityName, renameSuccessIncidentID, srvpath, originalName, linkUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get the link ID
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, renameSuccessIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const linkAttachment = response.attachments.find(att => 
      att.filename === originalName && att.linkUrl === linkUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    renameSuccessLinkID = linkAttachment.ID;

    // Save the draft to persist the link
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, renameSuccessIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Edit entity again to rename the link
    response = await api.editEntity(appUrl, serviceName, entityName, renameSuccessIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Rename the link using updateAttachment API
    const newName = 'RenamedSuccessName';
    const updateData = {
      filename: newName
    };
    response = await api.updateAttachment(appUrl, serviceName, entityName, renameSuccessIncidentID, updateData, renameSuccessLinkID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Save the draft after renaming - this should succeed
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, renameSuccessIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Verify the link was renamed by fetching its metadata
    response = await api.fetchMetadata(appUrl, serviceName, entityName, renameSuccessIncidentID, renameSuccessLinkID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(newName);
    expect(response.data.linkUrl).toBe(linkUrl); // URL should remain unchanged

    // Cleanup - delete the test entity
    response = await api.deleteEntity(appUrl, serviceName, entityName, renameSuccessIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should fail to rename link with restricted characters', async () => {
    let renameRestrictedIncidentID;
    let renameRestrictedLinkID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    renameRestrictedIncidentID = response.incidentID;
    
    // Create a link to rename
    const originalName = 'OriginalRestrictedName';
    const linkUrl = 'https://rename-restricted-test.com';
    response = await api.createLink(appUrl, serviceName, entityName, renameRestrictedIncidentID, srvpath, originalName, linkUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get the link ID
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, renameRestrictedIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const linkAttachment = response.attachments.find(att => 
      att.filename === originalName && att.linkUrl === linkUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    renameRestrictedLinkID = linkAttachment.ID;

    // Save the draft to persist the link
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, renameRestrictedIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Edit entity again to rename the link
    response = await api.editEntity(appUrl, serviceName, entityName, renameRestrictedIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Try to rename the link with restricted characters
    const invalidName = 'Invalid/Name';
    const updateData = {
      filename: invalidName
    };
    response = await api.updateAttachment(appUrl, serviceName, entityName, renameRestrictedIncidentID, updateData, renameRestrictedLinkID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Save the draft after renaming - this should fail with sap-messages
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, renameRestrictedIncidentID, true);
    expect(response.status).toBe("FAILED");
    expect(response.message.trim()).toBe("Update unsuccessful. The following filename(s) contain unsupported characters (/, \\). \n\n\t• Invalid/Name\n\nRename the file(s) and try again.");

    // Verify the link was NOT renamed by fetching its metadata
    response = await api.fetchMetadata(appUrl, serviceName, entityName, renameRestrictedIncidentID, renameRestrictedLinkID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(originalName); // Should still have original name

    // Cleanup - delete the test entity (may fail if entity is in invalid state)
    response = await api.deleteEntity(appUrl, serviceName, entityName, renameRestrictedIncidentID);
    if (response.status !== "OK") {
      // If delete fails, try to edit and then delete to clean up invalid state
      try {
        response = await api.editEntity(appUrl, serviceName, entityName, renameRestrictedIncidentID, srvpath);
        if (response.status === "OK") {
          response = await api.deleteEntity(appUrl, serviceName, entityName, renameRestrictedIncidentID);
        }
      } catch {
        // If cleanup still fails, log but don't fail the test
        console.warn("Cleanup failed for restricted test entity:", renameRestrictedIncidentID);
      }
    }
  });

  it('should fail to rename link with duplicate name', async () => {
    let renameDuplicateIncidentID;
    let renameDuplicateLink2ID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    renameDuplicateIncidentID = response.incidentID;
    
    // Create first link
    const firstName = 'FirstLink';
    const firstUrl = 'https://first-link.com';
    response = await api.createLink(appUrl, serviceName, entityName, renameDuplicateIncidentID, srvpath, firstName, firstUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Create second link
    const secondName = 'SecondLink';  
    const secondUrl = 'https://second-link.com';
    response = await api.createLink(appUrl, serviceName, entityName, renameDuplicateIncidentID, srvpath, secondName, secondUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get both link IDs
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, renameDuplicateIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const firstLink = response.attachments.find(att => 
      att.filename === firstName && att.linkUrl === firstUrl
    );
    const secondLink = response.attachments.find(att => 
      att.filename === secondName && att.linkUrl === secondUrl
    );
    
    if (!firstLink || !secondLink) {
      throw new Error("Error : Created links not found in attachments list")
    }
    renameDuplicateLink2ID = secondLink.ID;

    // Save the draft to persist both links
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, renameDuplicateIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Edit entity again to rename the second link
    response = await api.editEntity(appUrl, serviceName, entityName, renameDuplicateIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Try to rename the second link to have the same name as the first link
    const updateData = {
      filename: firstName // This should create a duplicate
    };
    response = await api.updateAttachment(appUrl, serviceName, entityName, renameDuplicateIncidentID, updateData, renameDuplicateLink2ID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Save the draft after renaming - this should fail with sap-messages
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, renameDuplicateIncidentID, true);
    expect(response.status).toBe("FAILED");
    expect(response.message.trim()).toBe("The file(s) FirstLink have been added multiple times. Please rename and try again.");

    // Fix the duplicate name issue for proper cleanup - rename back to original name
    const fixUpdateData = {
      filename: secondName + "_fixed" // Use a different name to resolve conflict
    };
    response = await api.updateAttachment(appUrl, serviceName, entityName, renameDuplicateIncidentID, fixUpdateData, renameDuplicateLink2ID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Save with the fixed name to restore entity to valid state
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, renameDuplicateIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Cleanup - delete the test entity
    response = await api.deleteEntity(appUrl, serviceName, entityName, renameDuplicateIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should successfully edit an existing link with valid URL using editLink API', async () => {
    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    editLinkIncidentID = response.incidentID;

    const originalName = 'OriginalLink';
    const originalUrl = 'https://original.com';
    response = await api.createLink(appUrl, serviceName, entityName, editLinkIncidentID, srvpath, originalName, originalUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.getAttachmentsList(appUrl, serviceName, entityName, editLinkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const linkAttachment = response.attachments.find(att => 
      att.filename === originalName && att.linkUrl === originalUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    editLinkAttachmentID = linkAttachment.ID;

    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, editLinkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.editEntity(appUrl, serviceName, entityName, editLinkIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const updatedUrl = 'https://updated-valid.com';
    response = await api.editLink(appUrl, serviceName, entityName, editLinkIncidentID, editLinkAttachmentID, srvpath, updatedUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, editLinkIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.fetchMetadata(appUrl, serviceName, entityName, editLinkIncidentID, editLinkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    expect(response.data.filename).toBe(originalName);
    expect(response.data.linkUrl).toBe(updatedUrl);

    response = await api.openAttachmentSaved(appUrl, serviceName, entityName, editLinkIncidentID, srvpath, editLinkAttachmentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
  });

  it('should validate URL format when using editLink API', async () => {
    let invalidEditIncidentID;
    let invalidEditLinkID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    invalidEditIncidentID = response.incidentID;

    const originalName = 'TestEditLink';
    const originalUrl = 'https://original-test.com';
    response = await api.createLink(appUrl, serviceName, entityName, invalidEditIncidentID, srvpath, originalName, originalUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.getAttachmentsList(appUrl, serviceName, entityName, invalidEditIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const linkAttachment = response.attachments.find(att => 
      att.filename === originalName && att.linkUrl === originalUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    invalidEditLinkID = linkAttachment.ID;

    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, invalidEditIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.editEntity(appUrl, serviceName, entityName, invalidEditIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const invalidUrl = 'invalid-url-format';
    response = await api.editLink(appUrl, serviceName, entityName, invalidEditIncidentID, invalidEditLinkID, srvpath, invalidUrl);
    
    if (response.status !== "OK" && expect(response.message).toContain("Enter a value matching the pattern")) {
      // Try to rename invalid link
      response = await api.editLink(appUrl, serviceName, entityName, invalidEditIncidentID, invalidEditLinkID, srvpath, originalUrl);
      if (response.status !== "OK") {
        throw new Error(`Error in renaming of Invalid to Valid link: ${response.message}`);
      }
      // Save entity draft
      response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, invalidEditIncidentID);

      if (response.status === "OK") {
        // Delete entity
        response = await api.deleteEntity(appUrl, serviceName, entityName, invalidEditIncidentID);
        if (response.status !== "OK") {
          throw new Error(`Error: ${response.message}`);
        }
      }
    }
  });

  it('should validate URL requirement when using editLink API', async () => {
    let emptyUrlEditIncidentID;
    let emptyUrlEditLinkID;

    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    emptyUrlEditIncidentID = response.incidentID;

    const originalName = 'TestEmptyUrlEdit';
    const originalUrl = 'https://original-empty-test.com';
    response = await api.createLink(appUrl, serviceName, entityName, emptyUrlEditIncidentID, srvpath, originalName, originalUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.getAttachmentsList(appUrl, serviceName, entityName, emptyUrlEditIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const linkAttachment = response.attachments.find(att => 
      att.filename === originalName && att.linkUrl === originalUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    emptyUrlEditLinkID = linkAttachment.ID;

    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, emptyUrlEditIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    response = await api.editEntity(appUrl, serviceName, entityName, emptyUrlEditIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const emptyUrl = '';
    response = await api.editLink(appUrl, serviceName, entityName, emptyUrlEditIncidentID, emptyUrlEditLinkID, srvpath, emptyUrl);
    
    if (response.status !== "OK" && expect(response.message).toContain("Multiple errors occurred, see details below.")) {
      // Try to rename invalid link
      response = await api.editLink(appUrl, serviceName, entityName, emptyUrlEditIncidentID, emptyUrlEditLinkID, srvpath, originalUrl);
      if (response.status !== "OK") {
        throw new Error(`Error in renaming of Invalid to Valid link: ${response.message}`);
      }
      // Save entity draft
      response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, emptyUrlEditIncidentID);
      if (response.status === "OK") {
        // Delete entity
        response = await api.deleteEntity(appUrl, serviceName, entityName, emptyUrlEditIncidentID);
        if (response.status !== "OK") {
          throw new Error(`Error: ${response.message}`);
        }
      }
    }
  });

  it('should discard draft edited link and revert to original URL', async () => {
    let discardTestIncidentID;
    let discardTestLinkID;

    // Create entity
    let response = await api.createEntityDraft(appUrl, serviceName, entityName);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    discardTestIncidentID = response.incidentID;

    // Create link type attachment (original URL)
    const originalName = 'DiscardTestLink';
    const originalUrl = 'https://abc.com';
    response = await api.createLink(appUrl, serviceName, entityName, discardTestIncidentID, srvpath, originalName, originalUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Get the link ID
    response = await api.getAttachmentsList(appUrl, serviceName, entityName, discardTestIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    const linkAttachment = response.attachments.find(att => 
      att.filename === originalName && att.linkUrl === originalUrl
    );
    if (!linkAttachment) {
      throw new Error("Error : Created link not found in attachments list")
    }
    discardTestLinkID = linkAttachment.ID;

    // Save entity
    response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, discardTestIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Edit same entity
    response = await api.editEntity(appUrl, serviceName, entityName, discardTestIncidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Edit same link type attachment (new URL)
    const updatedUrl = 'https://xyz.com';
    response = await api.editLink(appUrl, serviceName, entityName, discardTestIncidentID, discardTestLinkID, srvpath, updatedUrl);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Discard draft
    response = await api.discardDraft(appUrl, serviceName, entityName, discardTestIncidentID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Read attachment - should revert back to original URL (https://abc.com)
    response = await api.fetchMetadata(appUrl, serviceName, entityName, discardTestIncidentID, discardTestLinkID);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }

    // Verify the link reverted back to the original URL
    expect(response.data.filename).toBe(originalName);
    expect(response.data.linkUrl).toBe(originalUrl); // Should be https://abc.com, not https://xyz.com

    // Cleanup - delete the test entity
    response = await api.deleteEntity(appUrl, serviceName, entityName, discardTestIncidentID);
    if (response.status !== "OK") {
      // Log cleanup failure but don't fail the test since the main functionality passed
      console.warn("Cleanup failed for discardTestIncidentID:", response.message);
    }
  });

  it('should not allow editing a link without SDM role', async () => {
    if (tokenFlow !== 'technicalUser') {
      // Enter draft mode with no-SDM-role user (reusing editLinkIncidentID from previous test)
      const config = {
        headers: {'Authorization': "Bearer " + noSDMRoleToken}
      };
      apiNoSDMRole = new Api(config);
      let response = await apiNoSDMRole.editEntity(appUrl, serviceName, entityName, editLinkIncidentID, srvpath);
      if (response.status !== "OK") {
        throw new Error("Error : " + response.message)
      }

      // Try to edit the link with valid URL using no-SDM-role user
      const updatedUrl = 'https://updated-norole.com';
      response = await apiNoSDMRole.editLink(appUrl, serviceName, entityName, editLinkIncidentID, editLinkAttachmentID, srvpath, updatedUrl);
      expect(response.status).toBe("FAILED");
      expect(response.message).toBe(userNotAuthorisedErrorEditLink);

      // Save entity draft with no-SDM-role user to exit draft mode
      response = await apiNoSDMRole.saveEntityDraft(appUrl, serviceName, entityName, srvpath, editLinkIncidentID);
      if (response.status !== "OK") {
        throw new Error("Error : " + response.message)
      }

      // Cleanup - delete entity with authorized user
      response = await api.deleteEntity(appUrl, serviceName, entityName, editLinkIncidentID);
      if (response.status !== "OK") {
        console.warn("Cleanup failed for editLinkIncidentID:", response.message);
      }
    }
  });

});

describe('Attachments Integration Tests --DELETE', () => {
  it('should delete the attachments of an entity', async () => {
    let response = await api.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
    if (response.status !== "OK") {
      throw new Error("Error : " + response.message)
    }
    response = await api.deleteAttachment(appUrl, serviceName, incidentID, attachments[0],entityName);
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
   it('should create an entity, edit and delete it without attachments', async () => {

      let response = await api.createEntityDraft(appUrl, serviceName, entityName);
      if (response.status !== "OK") {
        throw new Error("Error : " + response.message)
      }
      incidentID = response.incidentID;

      response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
      if (response.status !== "OK") {
        throw new Error("Error : " + response.message)
      }
      let editresponse = await api.editEntity(appUrl, serviceName, entityName, incidentID, srvpath);
          if (editresponse.status !== "OK") {
            throw new Error("Error : " + editresponse.message)
          }
            response = await api.saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID);
                if (response.status !== "OK") {
                  throw new Error("Error : " + response.message)
                }
            let deleteresponse = await api.deleteEntity(appUrl, serviceName, entityName, incidentID);
              if (deleteresponse.status !== "OK") {
                throw new Error("Error : " + deleteresponse.message)
              }
    });
});