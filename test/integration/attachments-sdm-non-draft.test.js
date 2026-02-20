const axios = require('axios');
const credentials = require('./credentials.json');
const Api = require('./api');
const expect = require('@sap/cds/lib/test/expect');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');

const tenancyModel = process.env.TENANCY_MODEL || 'single';
const tenant = process.env.TENANT;

let token;
let noSDMRoleToken;
let api;
let apiNoSDMRole;
let projectID;
let appUrl;
let serviceName = 'processor';
let entityName = 'Projects';
let attachmentNavigation = 'references'; // Composition name in the deployed app
let srvpath = 'ProcessorService';
let attachments = [];
let projectToDelete;
let projectIDCustomProperty1;
let projectIDCustomProperty2;
let allCreatedProjects = []; // Track all projects for cleanup

beforeAll(async () => {
  let clientId;
  let clientSecret;
  let authUrl;

  if (tenancyModel === 'multi') {
    appUrl = credentials.appUrlMT;
    clientId = credentials.clientIDMT;
    clientSecret = credentials.clientSecretMT;

    if (tenant === 'SDM-DEV-CONSUMER-EU12') {
      console.log('Running non-draft integration tests | SDM-DEV-CONSUMER-EU12 tenant');
      authUrl = credentials.authUrlMTSDC;
    } else if (tenant === 'SDMGoogleWorkspaceConsumer') {
      console.log('Running non-draft integration tests | SDMGoogleWorkspaceConsumer tenant');
      authUrl = credentials.authUrlMTGWC;
    }
  } else {
    console.log('Running non-draft integration tests | Single tenant Scenario');
    appUrl = credentials.appUrl;
    clientId = credentials.clientID;
    clientSecret = credentials.clientSecret;
    authUrl = credentials.authUrl;
  }

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

  const config = {
    headers: { 'Authorization': "Bearer " + token }
  };
  api = new Api(config);

  // Small delay to ensure connection is stable before first test
  await new Promise(resolve => setTimeout(resolve, 1000));
});

// Helper function to track created projects
function trackProject(projectId) {
  if (projectId && !allCreatedProjects.includes(projectId)) {
    allCreatedProjects.push(projectId);
  }
  return projectId;
}

// Helper function to untrack a project when deleted within a test
function untrackProject(projectId) {
  const index = allCreatedProjects.indexOf(projectId);
  if (index > -1) {
    allCreatedProjects.splice(index, 1);
  }
}

describe('Non-Draft Attachments Integration Tests --CREATE', () => {
  
  it('should create a non-draft project entity', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Test Project for Non-Draft Attachments',
        description: 'Testing non-draft attachment functionality',
        status: 'Active'
      },
      config
    );

    expect(response.status).toBe(201);
    expect(response.data.ID).toBeDefined();
    projectID = trackProject(response.data.ID);
    console.log('Created project ID:', projectID);
    
    // Verify entity is accessible
    const verifyResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})`,
      config
    );
    expect(verifyResponse.status).toBe(200);
    console.log('Created project verified:', verifyResponse.data);
  });

  it('should create attachment metadata for non-draft entity', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}`,
      {
        filename: 'sample.pdf'
      },
      config
    );

    expect(response.status).toBe(201);
    expect(response.data.ID).toBeDefined();
    attachments.push({
      ID: response.data.ID,
      filename: 'sample.pdf'
    });
  });

  it('should upload attachment content for non-draft entity', async () => {
    const attachmentID = attachments[0].ID;
    const filePath = path.join(__dirname, 'sample.pdf');
    const fileBuffer = fs.readFileSync(filePath);

    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/pdf'
      }
    };

    const response = await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}(ID=${attachmentID})/content`,
      fileBuffer,
      config
    );

    expect(response.status).toBe(204);
  });

  it('should read attachment from non-draft entity', async () => {
    const attachmentID = attachments[0].ID;

    const config = {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      responseType: 'arraybuffer'
    };

    const response = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}(ID=${attachmentID})/content`,
      config
    );

    expect(response.status).toBe(200);
    expect(response.data).toBeDefined();
    expect(response.data.byteLength).toBeGreaterThan(0);
  });

  it('should list attachments for non-draft entity', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const response = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}`,
      config
    );

    expect(response.status).toBe(200);
    expect(response.data.value).toBeDefined();
    expect(response.data.value.length).toBeGreaterThan(0);
    expect(response.data.value[0].filename).toBe('sample.pdf');
  });

  it('should upload a single attachment and check if it has been uploaded with content --docx file', async () => {
    // A separate test case for docx files to test mimeType handling for Word documents
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    // Create attachment metadata for docx file
    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}`,
      {
        filename: 'test-document.docx'
      },
      config
    );

    expect(metadataResponse.status).toBe(201);
    expect(metadataResponse.data.ID).toBeDefined();
    const docxAttachmentID = metadataResponse.data.ID;

    // Upload docx file content
    const filePath = path.join(__dirname, 'sample-document.docx');
    const fileBuffer = fs.readFileSync(filePath);

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      }
    };

    const uploadResponse = await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}(ID=${docxAttachmentID})/content`,
      fileBuffer,
      uploadConfig
    );

    expect(uploadResponse.status).toBe(204);

    // Verify the docx file was uploaded by reading it back
    const readConfig = {
      headers: {
        'Authorization': `Bearer ${token}`
      },
      responseType: 'arraybuffer'
    };

    const readResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}(ID=${docxAttachmentID})/content`,
      readConfig
    );

    expect(readResponse.status).toBe(200);
    expect(readResponse.data).toBeDefined();
    expect(readResponse.data.byteLength).toBeGreaterThan(0);
    expect(readResponse.data.byteLength).toBe(fileBuffer.length);

    // Track this attachment for cleanup
    attachments.push({
      ID: docxAttachmentID,
      filename: 'test-document.docx'
    });
  });

  it('should not allow upload of duplicate files in same entity', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    // Create a new project for duplicate test
    const projectResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Duplicate Test Project'
      },
      config
    );

    expect(projectResponse.status).toBe(201);
    const duplicateTestProjectID = trackProject(projectResponse.data.ID);

    // Create first attachment
    const metadataResponse1 = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${duplicateTestProjectID})/${attachmentNavigation}`,
      {
        filename: 'duplicate-test.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadataResponse1.status).toBe(201);
    const attachment1ID = metadataResponse1.data.ID;

    // Upload content for first attachment
    const formData1 = new FormData();
    formData1.append('content', fs.createReadStream(path.join(__dirname, 'sample.pdf')));

    const uploadConfig1 = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData1.getHeaders()
      }
    };

    const uploadResponse1 = await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${duplicateTestProjectID})/${attachmentNavigation}(ID=${attachment1ID})/content`,
      formData1,
      uploadConfig1
    );

    expect(uploadResponse1.status).toBe(204);

    // Try to create second attachment with same filename
    const metadataResponse2 = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${duplicateTestProjectID})/${attachmentNavigation}`,
      {
        filename: 'duplicate-test.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadataResponse2.status).toBe(201);
    const attachment2ID = metadataResponse2.data.ID;

    // Upload content for second attachment should fail with 409 (duplicate)
    const formData2 = new FormData();
    formData2.append('content', fs.createReadStream(path.join(__dirname, 'sample.pdf')));

    const uploadConfig2 = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData2.getHeaders()
      }
    };

    try {
      await axios.put(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${duplicateTestProjectID})/${attachmentNavigation}(ID=${attachment2ID})/content`,
        formData2,
        uploadConfig2
      );
      fail('Should have thrown error for duplicate filename');
    } catch (error) {
      expect(error.response.status).toBe(409);
      expect(error.response.data.error.message).toContain('The following files could not be uploaded as they already exist:');
      expect(error.response.data.error.message).toContain('duplicate-test.pdf');
    }

    // Cleanup
    await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${duplicateTestProjectID})`,
      config
    );
    untrackProject(duplicateTestProjectID);
  });

  it('should allow upload of a duplicate file in a different entity', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    // Create first project
    const project1Response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Duplicate Test Project 1'
      },
      config
    );

    expect(project1Response.status).toBe(201);
    const project1ID = trackProject(project1Response.data.ID);

    // Create attachment in first project
    const metadata1Response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project1ID})/${attachmentNavigation}`,
      {
        filename: 'shared-file.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadata1Response.status).toBe(201);
    const attachment1ID = metadata1Response.data.ID;

    // Upload content for first attachment
    const formData1 = new FormData();
    formData1.append('content', fs.createReadStream(path.join(__dirname, 'sample.pdf')));

    const uploadConfig1 = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData1.getHeaders()
      }
    };

    const upload1Response = await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project1ID})/${attachmentNavigation}(ID=${attachment1ID})/content`,
      formData1,
      uploadConfig1
    );

    expect(upload1Response.status).toBe(204);

    // Create second project
    const project2Response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Duplicate Test Project 2'
      },
      config
    );

    expect(project2Response.status).toBe(201);
    const project2ID = trackProject(project2Response.data.ID);

    // Create attachment in second project with same filename - should succeed
    const metadata2Response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project2ID})/${attachmentNavigation}`,
      {
        filename: 'shared-file.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadata2Response.status).toBe(201);
    const attachment2ID = metadata2Response.data.ID;

    // Upload content for second attachment - should succeed
    const formData2 = new FormData();
    formData2.append('content', fs.createReadStream(path.join(__dirname, 'sample.pdf')));

    const uploadConfig2 = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData2.getHeaders()
      }
    };

    const upload2Response = await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project2ID})/${attachmentNavigation}(ID=${attachment2ID})/content`,
      formData2,
      uploadConfig2
    );

    expect(upload2Response.status).toBe(204);

    // Verify both files exist
    const list1Response = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project1ID})/${attachmentNavigation}`,
      config
    );
    expect(list1Response.data.value.some(att => att.filename === 'shared-file.pdf')).toBe(true);

    const list2Response = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project2ID})/${attachmentNavigation}`,
      config
    );
    expect(list2Response.data.value.some(att => att.filename === 'shared-file.pdf')).toBe(true);

    // Cleanup
    await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project1ID})`,
      config
    );
    await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${project2ID})`,
      config
    );
  });
});

describe('Non-Draft Attachments Integration Tests --READ', () => {
  
  it('should not read an attachment that does not exist', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const nonExistentAttachmentID = '00000000-0000-0000-0000-000000000000';

    try {
      await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectID})/${attachmentNavigation}(ID=${nonExistentAttachmentID})/content`,
        config
      );
      fail('Should have thrown error for non-existent attachment');
    } catch (error) {
      expect(error.response.status).toBe(404);
    }
  });
});

describe('Non-Draft Attachments Integration Tests --UPDATE/RENAME', () => {
  
  it('should create a document for rename tests', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project for Rename Test',
        description: 'Testing rename functionality'
      },
      config
    );

    expect(response.status).toBe(201);
    projectIDCustomProperty1 = trackProject(response.data.ID);
  });

  it('should upload attachment to document', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectIDCustomProperty1})/${attachmentNavigation}`,
      {
        filename: 'original-name.pdf'
      },
      config
    );

    expect(metadataResponse.status).toBe(201);
    const attachmentID = metadataResponse.data.ID;

    const filePath = path.join(__dirname, 'sample.pdf');
    const fileBuffer = fs.readFileSync(filePath);

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/pdf'
      }
    };

    const uploadResponse = await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectIDCustomProperty1})/${attachmentNavigation}(ID=${attachmentID})/content`,
      fileBuffer,
      uploadConfig
    );

    expect(uploadResponse.status).toBe(204);
    attachments.push({
      ID: attachmentID,
      filename: 'original-name.pdf',
      projectID: projectIDCustomProperty1
    });
  });

  it('should rename attachment in non-draft entity', async () => {
    const attachment = attachments.find(a => a.filename === 'original-name.pdf');
    
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    // Update the attachment directly (non-draft entities don't support deep updates)
    const response = await axios.patch(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectIDCustomProperty1})/${attachmentNavigation}(ID=${attachment.ID})`,
      {
        filename: 'renamed-file.pdf'
      },
      config
    );

    expect(response.status).toBe(200);

    // Verify the rename
    const verifyResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectIDCustomProperty1})/${attachmentNavigation}(ID=${attachment.ID})`,
      config
    );

    expect(verifyResponse.status).toBe(200);
    expect(verifyResponse.data.filename).toBe('renamed-file.pdf');
    
    // Store the attachment ID for next tests
    global.renamedAttachmentID = attachment.ID;
  });

  it('should reject rename with restricted characters', async () => {
    const attachmentID = global.renamedAttachmentID;
    
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    try {
      await axios.patch(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectIDCustomProperty1})/${attachmentNavigation}(ID=${attachmentID})`,
        {
          filename: 'invalid/name.pdf'
        },
        config
      );
      fail('Should have thrown an error for invalid filename');
    } catch (error) {
      expect(error.response.status).toBe(409);
      expect(error.response.data.error.message).toContain('unsupported characters');
    }
  });

  it('should reject rename with empty filename', async () => {
    const attachmentID = global.renamedAttachmentID;
    
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    try {
      await axios.patch(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectIDCustomProperty1})/${attachmentNavigation}(ID=${attachmentID})`,
        {
          filename: ''
        },
        config
      );
      fail('Should have thrown an error for empty filename');
    } catch (error) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.error.message).toContain('file name cannot be empty');
    }
  });

  it('should update valid custom properties of attachment', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    // Create a new project for custom property testing
    const projectResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Custom Property Test Project'
      },
      config
    );

    expect(projectResponse.status).toBe(201);
    const customPropProjectID = projectResponse.data.ID;

    // Create attachment metadata
    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${customPropProjectID})/${attachmentNavigation}`,
      {
        filename: 'custom-props-test.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadataResponse.status).toBe(201);
    const customAttachmentID = metadataResponse.data.ID;

    // Upload content
    const formData = new FormData();
    formData.append('content', fs.createReadStream(path.join(__dirname, 'sample.pdf')));

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData.getHeaders()
      }
    };

    await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${customPropProjectID})/${attachmentNavigation}(ID=${customAttachmentID})/content`,
      formData,
      uploadConfig
    );

    // Update attachment with valid custom properties
    const updateResponse = await axios.patch(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${customPropProjectID})/${attachmentNavigation}(ID=${customAttachmentID})`,
      {
        filename: 'custom-props-updated.pdf',
        customProperty1_code: 'test',
        customProperty2: 100,
        customProperty5: '2025-03-24T05:20:07Z',
        customProperty6: true
      },
      config
    );

    expect(updateResponse.status).toBe(200);

    // Verify custom properties were updated
    const metadataCheckResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${customPropProjectID})/${attachmentNavigation}(ID=${customAttachmentID})`,
      config
    );

    expect(metadataCheckResponse.status).toBe(200);
    expect(metadataCheckResponse.data.filename).toBe('custom-props-updated.pdf');
    expect(metadataCheckResponse.data.customProperty1_code).toBe('test');
    expect(metadataCheckResponse.data.customProperty2).toBe(100);
    expect(metadataCheckResponse.data.customProperty5).toBe('2025-03-24T05:20:07Z');
    expect(metadataCheckResponse.data.customProperty6).toBe(true);

    // Cleanup
    await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${customPropProjectID})`,
      config
    );
  });

  it('should handle invalid custom properties with warnings', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    // Create a new project
    const projectResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Invalid Custom Property Test Project'
      },
      config
    );

    expect(projectResponse.status).toBe(201);
    const invalidPropProjectID = projectResponse.data.ID;

    // Create two attachments
    const metadata1Response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}`,
      {
        filename: 'invalid-props-1.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadata1Response.status).toBe(201);
    const attachment1ID = metadata1Response.data.ID;

    const metadata2Response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}`,
      {
        filename: 'valid-props-2.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadata2Response.status).toBe(201);
    const attachment2ID = metadata2Response.data.ID;

    // Upload content for both attachments
    const formData1 = new FormData();
    formData1.append('content', fs.createReadStream(path.join(__dirname, 'sample.pdf')));

    const uploadConfig1 = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData1.getHeaders()
      }
    };

    await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}(ID=${attachment1ID})/content`,
      formData1,
      uploadConfig1
    );

    const formData2 = new FormData();
    formData2.append('content', fs.createReadStream(path.join(__dirname, 'sample2.pdf')));

    const uploadConfig2 = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData2.getHeaders()
      }
    };

    await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}(ID=${attachment2ID})/content`,
      formData2,
      uploadConfig2
    );

    // Update first attachment with invalid custom properties (customProperty3 and customProperty4 are not supported)
    const update1Response = await axios.patch(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}(ID=${attachment1ID})`,
      {
        filename: 'invalid-props-updated.pdf',
        customProperty1_code: 'test',
        customProperty2: 100,
        customProperty5: '2025-03-24T05:20:07Z',
        customProperty6: true,
        customProperty3: 'invalid value',
        customProperty4: 'invalid value'
      },
      config
    );

    // The update should return 200 with warnings in sap-messages header
    expect(update1Response.status).toBe(200);
    
    if (update1Response.headers['sap-messages']) {
      const sapMessages = JSON.parse(update1Response.headers['sap-messages']);
      expect(sapMessages).toBeDefined();
      expect(sapMessages.some(msg => msg.message.includes('secondary properties are not supported'))).toBe(true);
    }

    // Should match draft behavior: if ANY invalid property is present, NOTHING gets updated
    const metadata1CheckResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}(ID=${attachment1ID})`,
      config
    );

    expect(metadata1CheckResponse.data.filename).toBe('invalid-props-1.pdf'); // Filename should NOT change
    expect(metadata1CheckResponse.data.customProperty1_code).toBe(null); // Should remain null
    expect(metadata1CheckResponse.data.customProperty2).toBe(null); // Should remain null

    // Update second attachment with only valid custom properties
    const update2Response = await axios.patch(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}(ID=${attachment2ID})`,
      {
        filename: 'valid-props-updated.pdf',
        customProperty1_code: 'test',
        customProperty2: 100,
        customProperty5: '2025-03-24T05:20:07Z',
        customProperty6: true
      },
      config
    );

    expect(update2Response.status).toBe(200);

    // Verify valid properties were updated
    const metadata2CheckResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})/${attachmentNavigation}(ID=${attachment2ID})`,
      config
    );

    expect(metadata2CheckResponse.data.filename).toBe('valid-props-updated.pdf');
    expect(metadata2CheckResponse.data.customProperty1_code).toBe('test');
    expect(metadata2CheckResponse.data.customProperty2).toBe(100);
    expect(metadata2CheckResponse.data.customProperty5).toBe('2025-03-24T05:20:07Z');
    expect(metadata2CheckResponse.data.customProperty6).toBe(true);

    // Cleanup
    await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${invalidPropProjectID})`,
      config
    );
  });
});

describe('Non-Draft Attachments Integration Tests --DELETE', () => {
  
  it('should create a document for delete tests', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project for Delete Test',
        description: 'Testing delete functionality'
      },
      config
    );

    expect(response.status).toBe(201);
    projectToDelete = trackProject(response.data.ID);
  });

  it('should upload attachment to be deleted', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectToDelete})/${attachmentNavigation}`,
      {
        filename: 'to-be-deleted.pdf'
      },
      config
    );

    expect(metadataResponse.status).toBe(201);
    const attachmentID = metadataResponse.data.ID;

    const filePath = path.join(__dirname, 'sample.pdf');
    const fileBuffer = fs.readFileSync(filePath);

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/pdf'
      }
    };

    const uploadResponse = await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectToDelete})/${attachmentNavigation}(ID=${attachmentID})/content`,
      fileBuffer,
      uploadConfig
    );

    expect(uploadResponse.status).toBe(204);
    attachments.push({
      ID: attachmentID,
      filename: 'to-be-deleted.pdf',
      projectID: projectToDelete
    });
  });

  it('should delete single attachment from non-draft entity', async () => {
    const attachment = attachments.find(a => a.filename === 'to-be-deleted.pdf');
    
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const response = await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectToDelete})/${attachmentNavigation}(ID=${attachment.ID})`,
      config
    );

    expect(response.status).toBe(204);

    // Verify deletion
    try {
      await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${projectToDelete})/${attachmentNavigation}(ID=${attachment.ID})`,
        config
      );
      fail('Should have thrown 404 error');
    } catch (error) {
      expect(error.response.status).toBe(404);
    }
  });

  it('should delete project with all attachments', async () => {
    // Create a project with attachment
    const createConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const docResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project to Delete with Attachments'
      },
      createConfig
    );

    const docID = trackProject(docResponse.data.ID);

    // Add attachment
    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}`,
      {
        filename: 'will-be-deleted.pdf'
      },
      createConfig
    );

    const attachmentID = metadataResponse.data.ID;

    const filePath = path.join(__dirname, 'sample.pdf');
    const fileBuffer = fs.readFileSync(filePath);

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/pdf'
      }
    };

    await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}(ID=${attachmentID})/content`,
      fileBuffer,
      uploadConfig
    );

    // Delete the document
    const deleteConfig = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const deleteResponse = await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})`,
      deleteConfig
    );
    untrackProject(docID);

    expect(deleteResponse.status).toBe(204);

    // Verify document and attachments are deleted
    try {
      await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})`,
        deleteConfig
      );
      fail('Should have thrown 404 error');
    } catch (error) {
      expect(error.response.status).toBe(404);
    }
  });

  it('should delete an entity after all its attachments have been deleted', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    // Create a new project
    const projectResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project for Delete After Attachments Test'
      },
      config
    );

    expect(projectResponse.status).toBe(201);
    const testProjectID = trackProject(projectResponse.data.ID);

    // Create attachment metadata
    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})/${attachmentNavigation}`,
      {
        filename: 'test-file.pdf',
        mimeType: 'application/pdf'
      },
      config
    );

    expect(metadataResponse.status).toBe(201);
    const testAttachmentID = metadataResponse.data.ID;

    // Upload content
    const formData = new FormData();
    formData.append('content', fs.createReadStream(path.join(__dirname, 'sample.pdf')));

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        ...formData.getHeaders()
      }
    };

    await axios.put(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})/${attachmentNavigation}(ID=${testAttachmentID})/content`,
      formData,
      uploadConfig
    );

    // Delete the attachment first
    const deleteAttachmentConfig = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const deleteAttachmentResponse = await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})/${attachmentNavigation}(ID=${testAttachmentID})`,
      deleteAttachmentConfig
    );

    expect(deleteAttachmentResponse.status).toBe(204);

    // Verify attachment is deleted
    const listResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})/${attachmentNavigation}`,
      deleteAttachmentConfig
    );

    expect(listResponse.data.value.length).toBe(0);

    // Now delete the project
    const deleteProjectResponse = await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})`,
      deleteAttachmentConfig
    );
    untrackProject(testProjectID);

    expect(deleteProjectResponse.status).toBe(204);

    // Verify project is deleted
    try {
      await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})`,
        deleteAttachmentConfig
      );
      fail('Should have thrown 404 error');
    } catch (error) {
      expect(error.response.status).toBe(404);
    }
  });

  it('should create an entity, update it and delete it without attachments', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    // Create a project without attachments
    const projectResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project Without Attachments'
      },
      config
    );

    expect(projectResponse.status).toBe(201);
    const testProjectID = trackProject(projectResponse.data.ID);

    // Update the project
    const updateResponse = await axios.patch(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})`,
      {
        name: 'Updated Project Name'
      },
      config
    );

    expect(updateResponse.status).toBe(200);
    expect(updateResponse.data.name).toBe('Updated Project Name');

    // Verify no attachments exist
    const listResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})/${attachmentNavigation}`,
      config
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.data.value.length).toBe(0);

    // Delete the project
    const deleteConfig = {
      headers: {
        'Authorization': `Bearer ${token}`
      }
    };

    const deleteResponse = await axios.delete(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})`,
      deleteConfig
    );
    untrackProject(testProjectID);

    expect(deleteResponse.status).toBe(204);

    // Verify project is deleted
    try {
      await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${testProjectID})`,
        deleteConfig
      );
      fail('Should have thrown 404 error');
    } catch (error) {
      expect(error.response.status).toBe(404);
    }
  });
});

describe('Non-Draft Attachments Integration Tests --ERROR HANDLING', () => {
  
  it('should reject upload without SDM roles', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project for No SDM Role Test'
      },
      config
    );

    const docID = trackProject(response.data.ID);

    const noRoleConfig = {
      headers: {
        'Authorization': `Bearer ${noSDMRoleToken}`,
        'Content-Type': 'application/json'
      }
    };

    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}`,
      {
        filename: 'no-role-test.pdf'
      },
      noRoleConfig
    );

    const attachmentID = metadataResponse.data.ID;

    const filePath = path.join(__dirname, 'sample.pdf');
    const fileBuffer = fs.readFileSync(filePath);

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${noSDMRoleToken}`,
        'Content-Type': 'application/pdf'
      }
    };

    try {
      await axios.put(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}(ID=${attachmentID})/content`,
        fileBuffer,
        uploadConfig
      );
      fail('Should have thrown an error for no SDM roles');
    } catch (error) {
      expect(error.response.status).toBe(403);
    }
  });

  it('should reject file with restricted characters in filename', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project for Invalid Filename Test'
      },
      config
    );

    const docID = trackProject(response.data.ID);

    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}`,
      {
        filename: 'invalid/file.pdf'
      },
      config
    );

    const attachmentID = metadataResponse.data.ID;

    const filePath = path.join(__dirname, 'sample.pdf');
    const fileBuffer = fs.readFileSync(filePath);

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/pdf'
      }
    };

    try {
      await axios.put(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}(ID=${attachmentID})/content`,
        fileBuffer,
        uploadConfig
      );
      fail('Should have thrown an error for invalid filename');
    } catch (error) {
      expect(error.response.status).toBe(409);
      expect(error.response.data.error.message).toContain('Upload unsuccessful');
      expect(error.response.data.error.message).toContain('unsupported characters');
      expect(error.response.data.error.message).toContain('invalid/file.pdf');
    }
  });

  it('should reject file with empty filename during upload', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project for Empty Filename Test'
      },
      config
    );

    const docID = trackProject(response.data.ID);

    const metadataResponse = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}`,
      {
        filename: ''
      },
      config
    );

    const attachmentID = metadataResponse.data.ID;

    const filePath = path.join(__dirname, 'sample.pdf');
    const fileBuffer = fs.readFileSync(filePath);

    const uploadConfig = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/pdf'
      }
    };

    try {
      await axios.put(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}(ID=${attachmentID})/content`,
        fileBuffer,
        uploadConfig
      );
      fail('Should have thrown an error for empty filename');
    } catch (error) {
      expect(error.response.status).toBe(400);
      expect(error.response.data.error.message).toContain('file name cannot be empty');
    }
  });
});

describe('Non-Draft Attachments Integration Tests --MULTIPLE ATTACHMENTS', () => {
  
  it('should create project with multiple attachments', async () => {
    const config = {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

    const response = await axios.post(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
      {
        name: 'Project with Multiple Attachments'
      },
      config
    );

    const docID = trackProject(response.data.ID);

    // Upload 3 attachments
    const filenames = ['attachment1.pdf', 'attachment2.pdf', 'attachment3.pdf'];
    const uploadedAttachments = [];

    for (const filename of filenames) {
      const metadataResponse = await axios.post(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}`,
        { filename },
        config
      );

      expect(metadataResponse.status).toBe(201);
      const attachmentID = metadataResponse.data.ID;

      const filePath = path.join(__dirname, 'sample.pdf');
      const fileBuffer = fs.readFileSync(filePath);

      const uploadConfig = {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/pdf'
        }
      };

      const uploadResponse = await axios.put(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}(ID=${attachmentID})/content`,
        fileBuffer,
        uploadConfig
      );

      expect(uploadResponse.status).toBe(204);
      uploadedAttachments.push({ ID: attachmentID, filename });
    }

    // Verify all attachments exist
    const listResponse = await axios.get(
      `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${docID})/${attachmentNavigation}`,
      config
    );

    expect(listResponse.status).toBe(200);
    expect(listResponse.data.value.length).toBe(3);
    
    const returnedFilenames = listResponse.data.value.map(a => a.filename).sort();
    expect(returnedFilenames).toEqual(filenames.sort());
  });
});

afterAll(async () => {
  const config = {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };

  // Clean up all tracked projects
  for (const entityId of allCreatedProjects) {
    try {
      // Delete the entity - this triggers SDM folder cleanup via @cap-js/sdm plugin
      await axios.delete(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${entityId})`,
        config
      );
    } catch (error) {
      // Entity may already be deleted or not exist - ignore 404 errors
      if (error.response && error.response.status !== 404) {
        console.error(`Failed to delete entity ${entityId}:`, error.message);
      }
    }
  }
});
