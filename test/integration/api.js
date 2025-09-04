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

    async saveEntityDraft(appUrl, serviceName, entityName, srvpath, incidentID){
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
}

module.exports = Api;