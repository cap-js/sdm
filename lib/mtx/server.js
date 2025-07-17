const cds = require('@sap/cds');
const xssec = require("@sap/xssec");
const axios = require('axios');
const { requests } = xssec;
const { getConfigurations } = require("../util/index");
const { repositoryUrl, repositoryMissing } = require("../util/messageConsts");

// === Helper to create the repository request body ===
const buildRepositoryObject = () => {
    const { repositoryId } = getConfigurations();

    if (!repositoryId) {
        console.error(`Error creating repository object: ${repositoryMissing}`);
        throw new Error(repositoryMissing);
    }

    return {
        repository: {
            displayName: "SDM Repository",
            description: "Repository onboarded on subscription",
            repositoryType: "internal",
            isVersionEnabled: "false",
            isVirusScanEnabled: "false",
            skipVirusScanForLargeFile: "true",
            hashAlgorithms: "SHA-256",
            externalId: repositoryId,
        },
    };
};

// === Helper to fetch the SDM access token ===
const fetchSDMToken = (subdomain, uaa) => {
    console.log(`Fetching SDM token for subdomain: ${subdomain}`);
    
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

    // On tenant unsubscribe
    deploymentService.after('unsubscribe', async (_, req) => {
        const { tenant } = req.data;
        console.log(`🧹 SDM Plugin: Tenant unsubscribed — ${tenant}`);
        // Add unsubscription logic here 
    });
});
