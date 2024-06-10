const axios = require('axios');
const fs = require('fs');
const FormData = require('form-data');

class API {
    constructor(config) {
        config = JSON.parse(JSON.stringify(config));
        this.config = config
      }
      
    async createEntity(appUrl, serviceName, entityName, srvpath){
        let response;
        let incidentID;
        //Creating the entity (draft)
        response = await axios.post(
            `https://${appUrl}/odata/v4/${serviceName}/${entityName}`, 
            {
            title: 'IntegrationTestEntity',
            status_code: 'N'
            },
            this.config
        )
       
        incidentID = response.data.ID
        expect(response.status).toBe(201)
        expect(response.statusText).toBe('Created')
    
        //Saving the entity (draft)
        response = await axios.post(`
            https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftActivate`,
            {},
            this.config
        );  
        expect(response.status).toBe(201)
        expect(response.data.urgency_code).toBe('M')
    
        //Checking to see if the entity exists
        response = await axios.get(`
            https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)`,
            this.config
        );
        incidentID = response.data.ID

        if (response.status === 200 && response.data.status_code === 'N') {
            return { 
                status: "OK", 
                incidentID: incidentID 
            };
        }
        else {
            return "An error occured"
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
                return "OK"
            }
            else{
                return "An error occured"
            }
        } catch (error) {
            return "An error occured. Entity not found"
        }
    }

    async createAttachment(appUrl, serviceName, entityName, incidentID, srvpath, postData, files){
        let response;
        let responseStatus = {
            status: [],
            attachmentID: []
        };
        try{
            await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/${srvpath}.draftEdit`,
                {
                PreserveChanges: true,
                },
                this.config
            );

            for(let file of files){
                postData['filename'] = file.filename;

                try{
                    response = await axios.post(
                        `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments`,
                        postData,
                        this.config
                    )
                } catch (error){
                    continue
                }

                if (response.data && response.data.ID) {
                const formDataPut = new FormData();
                const pdfStream = fs.createReadStream(file.filepath); 
                formDataPut.append('content', pdfStream);
                responseStatus.attachmentID.push(response.data.ID)
                
                    try{
                        await axios.put(
                        `https://${appUrl}/odata/v4/${serviceName}/Incidents_attachments(up__ID=${incidentID},ID=${response.data.ID},IsActiveEntity=false)/content`,
                        formDataPut, 
                        this.config
                        );
                        response = await axios.get(
                            `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/attachments(up__ID=${incidentID},ID=${response.data.ID},IsActiveEntity=false)/content`,
                            this.config
                        );
                        if (response.status != 200 || !response.data){
                            return "An error occured, draft could not be read"
                        }
                    } catch (error) {
                        continue
                    }
                }   
            }
        
            if (response.status === 200 && response.data) {
                await axios.post(
                    `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftPrepare`,
                    {
                        SideEffectsQualifier: ""
                    },
                    this.config
                );
            }    
        
            this.config.headers['Content-Type'] = 'application/json';

            response = await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftActivate`,
                {},
                this.config
            );    
        
            //Checking to see whether the attachments was created
            for (let i = 0; i < files.length; i++) {
                response = await this.readAttachment(appUrl, serviceName, entityName, incidentID, [responseStatus.attachmentID[i]])
                responseStatus.status.push(response[0]) 
            }
            try{
                await axios.delete(
                    `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)`,
                        this.config
                    )
                delete this.config.headers['Content-Type'];
                return responseStatus
            } catch (error) {
                delete this.config.headers['Content-Type'];
                return responseStatus //If the draft doesn't exist, the delete request will fail. This try-catch block is to handle that scenario
            }
        } catch (error){
            try{
                await axios.delete(
                    `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)`,
                        this.config
                    )
                delete this.config.headers['Content-Type'];
                return "An error occured"
            } catch (error) {
                delete this.config.headers['Content-Type'];
                return "An error occured. Draft doesn't exist" //If the draft doesn't exist, the delete request will fail. This try-catch block is to handle that scenario
            }
        }
    }

    async readAttachment(appUrl, serviceName, entityName, incidentID, attachments){
        let readResponse = []
        for (let i = 0; i < attachments.length; i++) {
            try{
                let response;
                response = await axios.get(
                    `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/attachments(up__ID=${incidentID},ID=${attachments[i]},IsActiveEntity=true)/content`,
                    this.config
                );
                if (response.status === 200 && response.data) {
                    readResponse.push("OK");
                }
            } catch (error) {
                readResponse.push("An error occured. Attachment not found");
                continue
            }
        }
        return readResponse;
    }

    async deleteAttachment(appUrl, serviceName, entityName, incidentID, srvpath, attachments){
        let response;
        let responseStatus = [];
        try{
            await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/${srvpath}.draftEdit`,
                {
                PreserveChanges: true,
                },
                this.config
            );
        } catch (error) {
            return "An error occured"
        }

        for (let i = 0; i < attachments.length; i++) {
            try{
                await axios.delete(
                    `https://${appUrl}/odata/v4/${serviceName}/Incidents_attachments(up__ID=${incidentID},ID=${attachments[i]},IsActiveEntity=false)`,
                    this.config
                );
            } catch (error) {
                continue
            }
            }
    
        await axios.post(
            `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftPrepare`,
            {
                SideEffectsQualifier: ""
            },
            this.config
        );    
    
        this.config.headers['Content-Type'] = 'application/json';
        response = await axios.post(
            `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftActivate`,
            {},
            this.config
        );   
        
        for(let i = 0; i < attachments.length; i++){
            response = await this.readAttachment(appUrl, serviceName, entityName, incidentID, attachments);
            if (response[i] == "An error occured. Attachment not found"){
                responseStatus.push(response[i])
            }
        }
        delete this.config.headers['Content-Type'];
        return responseStatus
    }   

    async deleteAttachmentNeg(appUrl, serviceName, entityName, incidentID, srvpath, attachments){
        let response;
        let responseStatus = []
        try{
            await axios.post(
                `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=true)/${srvpath}.draftEdit`,
                {
                PreserveChanges: true,
                },
                this.config
            );
        } catch (error) {
            return "An error occured"
        }

        let configNeg = "invalid config";
        for (let i = 0; i < attachments.length; i++) {
            if(i>1){
                try{
                    await axios.delete(
                        `https://${appUrl}/odata/v4/${serviceName}/Incidents_attachments(up__ID=${incidentID},ID=${attachments[i]},IsActiveEntity=false)`,
                        configNeg
                    );
                } catch (error) {
                    continue
                }
            }
            else{
                try{
                    await axios.delete(
                        `https://${appUrl}/odata/v4/${serviceName}/Incidents_attachments(up__ID=${incidentID},ID=${attachments[i]},IsActiveEntity=false)`,
                        this.config
                    );
                } catch (error) {
                    continue
                }
            }
        }
    
        await axios.post(
            `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftPrepare`,
            {
                SideEffectsQualifier: ""
            },
            this.config
        );    
    
        this.config.headers['Content-Type'] = 'application/json';
        response = await axios.post(
            `https://${appUrl}/odata/v4/${serviceName}/${entityName}(ID=${incidentID},IsActiveEntity=false)/${srvpath}.draftActivate`,
            {},
            this.config
        );   
        
        response = await this.readAttachment(appUrl, serviceName, entityName, incidentID, attachments);
        for(let i = 0; i < attachments.length; i++){
            if (response[i] == "An error occured. Attachment not found"){
                responseStatus.push(response[i])
            }
            else{
                responseStatus.push(response[i])
            }
        }
        delete this.config.headers['Content-Type'];
        return responseStatus
    }   
}

module.exports = API;