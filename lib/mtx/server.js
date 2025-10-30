const cds = require('@sap/cds');
const xssec = require("@sap/xssec");
const axios = require('axios');
const path = require('path');
const requests = xssec.v3.requests;
const { getConfigurations } = require("../util/index");
const { skippingOnboarding } = require("../util/messageConsts");
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
            return response.data;
        } catch (error) {
            const status = error?.response?.status;
            const data = error?.response?.data;

            // Extract IDs for clarity
            const repo = repositoryObject.repository || {};
            const externalId = repo.externalId;
            const displayName = repo.displayName || repo.name || 'Repository';

            // === Handle "already exists" (409 Conflict) ===
            if (status === 409) {
                const messageString = typeof data === 'string' ? data : JSON.stringify(data);
                if (messageString.includes(`${externalId} already exists`) || messageString.includes('already exists')) {
                    console.info(skippingOnboarding(displayName, externalId));
                    return { skipped: true, message: skippingOnboarding(displayName, externalId) };
                }
            }

            // === For any other error, rethrow ===
            throw data || error;
        }
    };


    // === Helper to GET a list of repositories ===
    const listRepositories = async (sdmUrl, token) => {
        const url = `${sdmUrl}${repositoryUrl}`;
        const headers = { 'Authorization': `Bearer ${token}` };
        try {
            const response = await axios.get(url, { headers });
            let repos = response.data?.repoAndConnectionInfos || [];
            // if tenant has only one repository, return as array
            if (!Array.isArray(repos)) {
                repos = [repos];
            }
            return repos;
        } catch (error) {
            console.error("Error listing SDM repositories:", error?.response?.data || error);
            throw error;
        }
    };

    // === Helper to DELETE the repository object from SDM ===
    const offboardRepository = async (sdmUrl, repoId, token) => {
        const url = `${sdmUrl}${repositoryUrl}/${repoId}`;
        const headers = {
            'Authorization': `Bearer ${token}`,
        };

        try {
            await axios.delete(url, { headers });
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
            throw err;
        }
        });

    // On tenant unsubscribe
    deploymentService.after('unsubscribe', async (_, req) => {
        const { tenant, options } = req.data;
        const subdomain = options?.subscribedSubdomain;
        const SDMCredentials = cds.env.requires?.sdm?.credentials;
        const sdmUrl = SDMCredentials?.uri;

        console.log(`SDM Plugin: Tenant Unsubscription started — ${tenant}`);

        try {
            const { repositoryId } = getConfigurations();
            if (!repositoryId) {
                return;
            }
            const token = await fetchSDMToken(subdomain, SDMCredentials.uaa);
            const allRepos = await listRepositories(sdmUrl, token);
            const repoToOffboard = allRepos.find(
                repoInfo => repoInfo?.repository?.externalId === repositoryId
            );

            if (!repoToOffboard) {
                console.error(`SDM Plugin: Could not find a repository with externalId '${repositoryId}' for tenant ${tenant}.`);
            } else {
                const foundRepositoryId = repoToOffboard.repository.id;
                await offboardRepository(sdmUrl, foundRepositoryId, token);
                console.log("SDM repository offboarded");
            }
        } catch (err) {
            console.error("Error during SDM offboarding:", err);
            throw err;
        }
    });
    });
}