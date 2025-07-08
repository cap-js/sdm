const cds = require('@sap/cds');
const axios = require('axios');
const { getConfigurations, getClientCredentialsToken } = require("./util/index");
const { repositoryUrl, repositoryMissing } = require("./util/messageConsts");

const _setRepositoryObject = async () => {
    const { repositoryId } = getConfigurations();

    if (!repositoryId) {
        DEBUG?.(`Error creating repository object: ${repositoryMissing}`);
        throw new Error(repositoryMissing);
    }

    const repository = new FormData();
    repository.append("displayName", "SDM Repository");
    repository.append("description", "Repository onboarded on subscription");
    repository.append("repositoryType", "internal");
    repository.append("isVersionEnabled", "false");
    repository.append("isVirusScanEnabled", "false");
    repository.append("skipVirusScanForLargeFile", "true");
    repository.append("hashAlgorithms", "SHA-256");
    repository.append("externalId", repositoryId);
    return repository;
};

const _onboardRepository = async (formData, token) => {
    const onboardUrl = `${sdmUrl}${repositoryUrl}`;
    const headers = {
      ...formData.getHeaders(),
      Authorization: `Bearer ${token}`,
    };
  
    try {
      const response = await axios.post(onboardUrl, formData, { headers });
      return response;
    } catch (error) {
      throw error?.response?.data || error;
    }
}

cds.on('listening', async () => {
    const profile = cds.env.profile;
    const sdm = cds.env.requires?.sdm ?? null;
    if (sdm) {
        const ds = await cds.connect.to("cds.xt.DeploymentService");
        ds.after('subscribe', async (_, req) => {
            const { tenant } = req.data;
            try {
                const repository = await _setRepositoryObject();

                const token = await getClientCredentialsToken(req.creds)

                await _onboardRepository(repository, token);
                DEBUG?.('SDM repository onboarded');
            } catch (error) {
                console.error(`Error onboarding SDM repository for tenant - ${tenant}: ${error.message}`);
            }
        });

        ds.after('unsubscribe', async (_, req) => {
            const { tenant } = req.data;
            try {
                const serviceManagerCredentials = cds.env.requires?.serviceManager?.credentials;
                const { sm_url, url, clientid, clientsecret } = serviceManagerCredentials;

                const token = await _fetchToken(url, clientid, clientsecret)

                const bindingID = await _getBindingIdForDeletion(sm_url, tenant, token);

                await _deleteBinding(sm_url, bindingID, token);

                const service_instance_id = await _getInstanceIdForDeletion(sm_url, tenant, token);

                await _deleteObjectStoreInstance(sm_url, service_instance_id, token);
            } catch (error) {
                // eslint-disable-next-line no-console
                console.error(`Error deleting object store service for tenant - ${tenant}: ${error.message}`);
            }

        });
    }
    module.exports = cds.server;
});
