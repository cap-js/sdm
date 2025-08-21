const cds = require('@sap/cds');
const xssec = require("@sap/xssec");
const axios = require('axios');
const path = require('path');
const requests = xssec.v3.requests;
const { getConfigurations } = require("../util/index");
const profile = cds.env.profile;
let configPath;

if (profile === "mtx-sidecar") {
    const { repositoryUrl, repositoryMissing, repositoryConfigurationMissing } = require("../util/messageConsts");
    configPath = path.join(cds.root, 'SDMRepositoryConfig.js');
    const config = require(configPath);
    if (!config || !config.sdm) {
        throw new Error(repositoryConfigurationMissing);
    }
    const { sdm } = config;
    const buildRepositoryObject = () => {
    const { repositoryId } = getConfigurations();
    const repositoryConfig = sdm.repositoryConfig;
    
    if (!repositoryId || !repositoryConfig) {
        throw new Error(repositoryMissing);
    }

    const repositoryObject = {
        repository: {
            ...repositoryConfig,
            externalId: repositoryId
        }
    };
    return repositoryObject;
    };

    // === Helper to fetch the SDM access token ===
    const fetchSDMToken = (subdomain, uaa) => {
    return new Promise((resolve, reject) => {
        requests.requestClientCredentialsToken(subdomain, uaa, null, (err, token) => {
            if (err) {
                console.error("Failed to fetch access token:", err);
                reject(err);
            } else {
                resolve(token);
            }
        });
    });
    };

    // === Helper to POST the repository object to SDM ===
    const onboardRepository = async (sdmUrl, repositoryObject, token) => {
    const url = `${sdmUrl}${repositoryUrl}`;
    const headers = {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
    };

    try {
        const response = await axios.post(url, repositoryObject, { headers });
        return response;
    } catch (error) {
        throw error?.response?.data || error;
    }
    };

    // === Hook into CAP subscription lifecycle ===
    cds.on('listening', async () => {
    const deploymentService = await cds.connect.to("cds.xt.DeploymentService");

    if (!deploymentService) {
        console.error("Failed to connect to cds.xt.DeploymentService");
        return;
    }

    // On tenant subscribe
    deploymentService.after('subscribe', async (_, req) => {
        const { tenant, metadata } = req.data;
        const subdomain = metadata?.subscribedSubdomain;
        const SDMCredentials = cds.env.requires?.sdm?.credentials;
        const sdmUrl = SDMCredentials?.uri;

        console.log(`SDM Plugin: Tenant subscription started — ${tenant}`);

        try {
            const repository = buildRepositoryObject();
            const token = await fetchSDMToken(subdomain, SDMCredentials.uaa);
            await onboardRepository(sdmUrl, repository, token);
            console.log("SDM repository onboarded");
        } catch (err) {
            console.error("Error during SDM onboarding:", err);
        }
        });
    });
}