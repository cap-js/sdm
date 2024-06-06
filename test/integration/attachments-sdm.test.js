const axios = require("axios");
const fs = require("fs");
const FormData = require("form-data");
const credentials = require("./credentials.json");

describe("Attachments Integration Tests", () => {
  let token;
  let sampleAttachmentID;
  let appUrl = credentials.appUrl;
  let incidentID = credentials.incidentID;
  let serviceName = "processor";
  let entityName = "Incidents";
  let srvpath = "ProcessorService";

  //Generating the CAP Application token
  beforeAll(async () => {
    try {
      const authRes = await axios.post(
        `${credentials.authUrl}`,
        {},
        {
          auth: {
            username: credentials.clientID,
            password: credentials.clientSecret,
          },
        }
      );

      token = authRes.data.access_token;
    } catch (error) {
      expect(error).toBeUndefined;
    }
  });

  it("should create an attachment and check if it has been created", async () => {
    try {
      const config = {
        headers: { Authorization: "Bearer " + token },
      };

      //Setting draft mode and uploading the attachment
      await axios.post(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/${srvpath}.draftEdit`,
        {
          PreserveChanges: true,
        },
        config
      );

      const postData = {
        up__ID: incidentID,
        filename: "sample.pdf",
        mimeType: "application/pdf",
        createdAt: new Date(
          Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
        ).toISOString(),
        createdBy: "test@test.com",
        modifiedBy: "test@test.com",
      };

      response = await axios.post(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments`,
        postData,
        config
      );

      if (response.data && response.data.ID) {
        const formDataPut = new FormData();
        const pdfStream = fs.createReadStream("./sample.pdf");
        pdfStream.on("error", (error) =>
          console.log("Error reading file:", error)
        );
        formDataPut.append("content", pdfStream);
        sampleAttachmentID = response.data.ID;

        //Uploading the actual content into the created attachment
        await axios.put(
          `https://${appUrl}/odata/v4/${serviceName}/Incidents_attachments(up__ID=${incidentID},ID=${sampleAttachmentID},IsActiveEntity=false)/content`,
          formDataPut,
          config
        );
      }

      await axios.post(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftPrepare`,
        {
          SideEffectsQualifier: "",
        },
        config
      );

      config.headers["Content-Type"] = "application/json";
      response = await axios.post(
        `
        https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftActivate`,
        {},
        config
      );

      //Checking to see whether the attachment was created
      response = await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleAttachmentID},IsActiveEntity=true)/content`,
        config
      );
      expect(response.status).toBe(200);
      expect(response.data).toNotBeUndefined;
      expect(response.headers["content-type"]).toBe("application/pdf");
    } catch (error) {
      expect(error).toBeUndefined;
    }
  });

  it("should read the created attachment", async () => {
    try {
      const config = {
        headers: { Authorization: "Bearer " + token },
      };

      const response = await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleAttachmentID},IsActiveEntity=true)/content`,
        config
      );

      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toBe("application/pdf");
    } catch (error) {
      console.error(error);
    }
  });

  it("should respond with 400 when the attachment is not found", async () => {
    let nonExistentincidentID = "Incorrect Incident ID";
    let nonExistentID = "Incorrect attachment ID";

    try {
      const config = {
        headers: { Authorization: "Bearer " + token },
      };

      await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${nonExistentincidentID},IsActiveEntity=true)/attachments(up__ID=${nonExistentincidentID},ID=${nonExistentID},IsActiveEntity=true)/content`,
        config
      );

      throw new Error("Expected request to fail but it succeeded"); // This line will be executed if the previous line does not throw an error.
    } catch (error) {
      expect(error.response.status).toBe(400);
    }
  });

  it("should delete an attachment and make sure it doesnt exist", async () => {
    const config = {
      headers: { Authorization: "Bearer " + token },
    };

    try {
      //Setting draft mode and uploading the attachment
      await axios.post(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/${srvpath}.draftEdit`,
        {
          PreserveChanges: true,
        },
        config
      );

      await axios.delete(
        `https://${appUrl}/odata/v4/${serviceName}/Incidents_attachments(up__ID=${incidentID},ID=${sampleAttachmentID},IsActiveEntity=false)`,
        config
      );

      await axios.post(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftPrepare`,
        {
          SideEffectsQualifier: "",
        },
        config
      );

      config.headers["Content-Type"] = "application/json";

      await axios.post(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftActivate`,
        {},
        config
      );

      //Making sure the attachment doesn't exist
      response = await axios.get(
        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${sampleAttachmentID},IsActiveEntity=true)/content`,
        config
      );
    } catch (error) {
      expect(error.response.status).toBe(404);
    }
  });
});
