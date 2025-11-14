const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

class Api {
    constructor(config) {
        config = JSON.parse(JSON.stringify(config));
        this.config = config
      }

    async createEntityDraft(appUrl, serviceName, entityName){
        let response;
        let incidentID;
        //Creating the entity (draft)
        try{
            response = await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}`,
                {
                title: 'IntegrationTestEntity',
                status_code: 'N'
                },
                this.config
            )

            incidentID = response.data.ID
            if (response.status === 201 && response.statusText === 'Created') {
                return {
                    status: "OK",
                    incidentID: incidentID
                };
            }
            else {
                return {
                    status: "FAILED" ,
                    message: "Create entity draft did not return 201 status code. Actual code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Create entity draft API call failed : " + error.message
            };
        }

    }

    async saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID, treatWarningsAsErrors = false){
        //Saving the entity (draft)
        let response;
        try{
            response = await axios.post(`
                https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftActivate`,
                {},
                this.config
            );
            let sapMessages = "";
            sapMessages = response.headers['sap-messages'];
            
            if (response.status === 201 || response.status === 200) {
                if (sapMessages) {
                    try {
                        const messages = JSON.parse(sapMessages);
                        const severityThreshold = treatWarningsAsErrors ? 3 : 4;
                        const errorMessages = messages.filter(msg => 
                            (msg.severity && msg.severity >= severityThreshold) || 
                            (msg.numericSeverity && msg.numericSeverity >= severityThreshold)
                        );
                        if (errorMessages.length > 0) {
                            return {
                                status: "FAILED",
                                message: errorMessages[0].message || errorMessages[0].details || "Validation error occurred"
                            };
                        }
                    } catch {
                        // Parse error - ignore
                    }
                }
                return {
                    status: "OK",
                    sapMessages: sapMessages
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Save entity draft did not return 200/201 status code. Actual code : " + response.status
                };
            }
        } catch (error) {
            if (error.response?.data?.error?.message) {
                return {
                    status: "FAILED",
                    message: error.response.data.error.message
                };
            }
            
            return {
                status: "FAILED",
                message: "Save entity draft API call failed : " + error.message
            };
        }
    }

    async editEntity(appUrl, serviceName, entityName, incidentID, srvpath){
        try{
            let response = await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/${srvpath}.draftEdit`,
                {
                PreserveChanges: true,
                },
                this.config
            );
            if (response.status === 201 && response.data) {
                return {
                    status: "OK",
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Edit entity draft did not return 201 status code. Actual code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Edit entity draft API call failed : " + error.message
            };
        }
    }

    async checkEntity(appUrl, serviceName, entityName, incidentID){
        //Checking to see if the entity exists
        try{
            response = await axios.get(`
                https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)`,
                this.config
            );
            incidentID = response.data.ID

            if (response.status === 200) {
                return {
                    status: "OK"
                };
            }
            else {
                return {
                    status: "FAILED",
                    message: "Check entity draft did not return 200 status code. Actual code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Check entity draft API call failed : " + error.message
            };
        }

    }

    async deleteEntity(appUrl, serviceName, entityName, incidentID){
        let response;
        try{
            response = await axios.delete(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)`,
                this.config
            )
            if(response.status == 204){
                return {
                    status: "OK",
                };
            }
            else{
                return {
                    status: "FAILED",
                    message: "Delete entity draft did not return 204 status code. Actual code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Delete entity draft API call failed : " + error.message
            };
        }
    }

    async createAttachment(appUrl, serviceName, entityName, incidentID, postData, file){
        let response;
        postData['filename'] = file.filename;

        try{
            response = await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments`,
                postData,
                this.config
            )
            if (response.data && response.data.ID) {
                const formDataPut = new FormData();
                const pdfStream = fs.createReadStream(file.filepath);
                formDataPut.append('content', pdfStream);
                // responseStatus.attachmentID.push(response.data.ID)
                 try{
                    await axios.put(
                     `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments(ID=${response.data.ID},IsActiveEntity=false)/content`,

                    formDataPut,
                    this.config
                    );

                    if (response.status === 201) {
                        return {
                            status: "OK",
                            ID: response.data.ID
                        }
                    } else {
                        return {
                            status: "FAILED",
                            message: "Create attachment (put) did not return 201 status code. Actual code : " + response.status
                        };
                    }
                }
                catch (error) {
                    return {
                        status: "FAILED",
                        message: "Create attachment API call (put) failed : " + error.message,
                        ID: response.data.ID
                    };
                }
            } else {
                return {
                    status: "FAILED",
                    message: "Create attachment (post) did not return a valid response"
                };
            }
        }
        catch (error){
            return {
                status: "FAILED",
                message: "Create attachment API call failed : " + error.message
            };
        }
    }

    async readAttachment(appUrl, serviceName, entityName, incidentID, attachment){
        try{
            let response;
            response = await axios.get(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${attachment},IsActiveEntity=true)/content`,
                this.config
            );
            if (response.status === 200 && response.data) {
                return {
                    status: "OK"
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Read attachment did not return 200 status code. Actual code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Read attachment API call failed : " + error.message
            };
        }
    }

    async fetchMetadata(appUrl, serviceName, entityName, incidentID, attachment) {
        let response;

        try {
            response = await axios.get(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${attachment},IsActiveEntity=true)`,
                this.config
            );

            if (response.status === 200 && response.data) {
                return {
                    status: "OK",
                    data: response.data
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Fetch metadata did not return 200 status code. Actual code: " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Fetch metadata API call failed: " + error.message
            };
        }
    }

    async updateAttachment(appUrl, serviceName, entityName, incidentID, updateData, attachment){
        let response;
         try{
            response = await axios.patch(
               `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments(ID=${attachment},IsActiveEntity=false)`,
                updateData,
                this.config
            );
            if (response.status === 200) {
                return {
                    status: "OK"
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Update attachment did not return 200 status code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Update attachment API call failed : " + error.message
            };
        }
    }

    async deleteAttachment(appUrl, serviceName, incidentID, attachment,entityName){
        let response;
        try{
            response = await axios.delete(
                 `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments(ID=${attachment},IsActiveEntity=false)`,
                this.config
            );
            if (response.status === 204) {
                return {
                    status: "OK"
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Delete attachment did not return 204 status code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Delete attachment API call failed : " + error.message
            };
        }
    }

    async createLink(appUrl, serviceName, entityName, incidentID, srvpath, name, url) {
        let response;
        try {
            const linkData = {
                name: name,
                url: url
            };
            
            response = await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments/${srvpath}.createLink`,
                linkData,
                this.config
            )
            
            if (response.status === 204) {
                return {
                    status: "OK"
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Create link did not return 204 status code : " + response.status
                };
            }
        } catch (error) {
            // Extract server error message if available
            let errorMessage = "Create Link API call failed : " + error.message;
            if (error.response && error.response.data && error.response.data.error && error.response.data.error.message) {
                errorMessage = error.response.data.error.message;
            }
            return {
                status: "FAILED",
                message: errorMessage
            };
        }
    }

    async editLink(appUrl, serviceName, entityName, incidentID, linkID, srvpath, url) {
        let response;
        try {
            const linkData = {
                url: url
            };

            // Construct OData editLink URL
            const requestUrl = `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments(up__ID=${incidentID},ID=${linkID},IsActiveEntity=false)/${srvpath}.editLink`;

            response = await axios.post(requestUrl, linkData, this.config);

            if (response.status === 204) {
                return {
                    status: "OK"
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Edit link did not return 204 status code : " + response.status
                };
            }
        } catch (error) {
            // Extract server error message if available
            let errorMessage = "Edit Link API call failed : " + error.message;
            if (error.response && error.response.data && error.response.data.error && error.response.data.error.message) {
                errorMessage = error.response.data.error.message;
            }
            return {
                status: "FAILED",
                message: errorMessage
            };
        }
    }

    async getAttachmentsList(appUrl, serviceName, entityName, incidentID) {
        let response;
        try {
            response = await axios.get(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments`,
                this.config
            );
            if (response.status === 200 && response.data && response.data.value) {
                return {
                    status: "OK",
                    attachments: response.data.value
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Get attachments list did not return 200 status code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Get attachments list API call failed : " + error.message
            };
        }
    }

    async openAttachment(appUrl, serviceName, entityName, incidentID, srvpath, attachment) {
        let response;
        try {
            response = await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments(ID=${attachment},IsActiveEntity=false)/${srvpath}.openAttachment`,
                {},
                this.config
            )
            if (response.status === 200) {
                return {
                    status: "OK",
                    data: response.data
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Open attachment did not return 200 status code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Open attachment API call failed : " + error.message
            };
        }
    }

    async openAttachmentSaved(appUrl, serviceName, entityName, incidentID, srvpath, attachment) {
        let response;
        try {
            response = await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/attachments(ID=${attachment},IsActiveEntity=true)/${srvpath}.openAttachment`,
                {},
                this.config
            )
            if (response.status === 200) {
                return {
                    status: "OK",
                    data: response.data
                };
            } else {
                return {
                    status: "FAILED",
                    message: "Open attachment saved did not return 200 status code : " + response.status
                };
            }
        } catch (error) {
            return {
                status: "FAILED",
                message: "Open attachment saved API call failed : " + error.message
            };
        }
    }
}

module.exports = Api;