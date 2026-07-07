const cds = require('@sap/cds');
const path = require('path');
const { getConfigurations, transformSDMServiceBindingToClientCredentialsDestination, getSdmInstanceName } = require("../util/index");
const { skippingOnboarding } = require("../util/messageConsts");
const { executeHttpRequest } = require('@sap-cloud-sdk/http-client');
const { getDestinationFromServiceBinding } = require('@sap-cloud-sdk/connectivity');
const LOG = cds.log('sdm');
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

    // === Helper to create destination object for SDM ===
    const getDestination = async (subdomain) => {
        const destination = await getDestinationFromServiceBinding({
            destinationName: getSdmInstanceName(),
            useCache: false,
            serviceBindingTransformFn: (serviceBinding, options) => transformSDMServiceBindingToClientCredentialsDestination(serviceBinding, options,subdomain)
        });
        return destination;
    };

    // === Helper to POST the repository object to SDM ===
    const onboardRepository = async (sdmUrl, repositoryObject, destination) => {
        const url = `${sdmUrl}${repositoryUrl}`;

        try {
            const response = await executeHttpRequest(
                destination,
                {
                    method: 'POST',
                    url: url,
                    data: repositoryObject,
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );
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
                    LOG.info(`[INFO] ${skippingOnboarding(displayName, externalId)}`);
                    return { skipped: true, message: skippingOnboarding(displayName, externalId) };
                }
            }

            // === For any other error, rethrow ===
            throw data || error;
        }
    };


    // === Helper to GET a list of repositories ===
    const listRepositories = async (sdmUrl, destination) => {
        const url = `${sdmUrl}${repositoryUrl}`;
        try {
            const response = await executeHttpRequest(
                destination,
                {
                    method: 'GET',
                    url: url
                }
            );
            let repos = response.data?.repoAndConnectionInfos || [];
            // if tenant has only one repository, return as array
            if (!Array.isArray(repos)) {
                repos = [repos];
            }
            return repos;
        } catch (error) {
            LOG.error("[ERROR] Error listing SDM repositories:", error?.response?.data || error);
            throw error;
        }
    };

    // === Helper to DELETE the repository object from SDM ===
    const offboardRepository = async (sdmUrl, repoId, destination) => {
        const url = `${sdmUrl}${repositoryUrl}/${repoId}`;

        try {
            await executeHttpRequest(
                destination,
                {
                    method: 'DELETE',
                    url: url
                }
            );
        } catch (error) {
            throw error?.response?.data || error;
        }
    };

    // === Hook into CAP subscription lifecycle ===
    cds.on('listening', async () => {
    const deploymentService = await cds.connect.to("cds.xt.DeploymentService");

    if (!deploymentService) {
        LOG.error("[ERROR] Failed to connect to cds.xt.DeploymentService");
        return;
    }

    // On tenant subscribe
    deploymentService.after('subscribe', async (_, req) => {
        const { tenant, metadata } = req.data;
        const subdomain = metadata?.subscribedSubdomain;
        LOG.debug(`[DEBUG] SUBDOMAIN DURING SUBSCRIBE ${subdomain}`);
        const SDMCredentials = cds.env.requires?.sdm?.credentials;
        const sdmUrl = SDMCredentials?.uri;

        LOG.info(`[INFO] SDM Plugin: Tenant subscription started - ${tenant}`);

        try {
            const repository = buildRepositoryObject();
            const destination = await getDestination(subdomain);
            await onboardRepository(sdmUrl, repository, destination);
            LOG.info("[INFO] SDM repository onboarded");
        } catch (err) {
            LOG.error('[FATAL] Error during SDM onboarding:', err);
            throw err;
        }
        });

    // On tenant unsubscribe
    deploymentService.after('unsubscribe', async (_, req) => {
        const { tenant, options } = req.data;
        const subdomain = options?.subscribedSubdomain;
        LOG.debug(`[DEBUG] SUBDOMAIN AFTER UNSUBSCRIBE ${subdomain}`);
        const SDMCredentials = cds.env.requires?.sdm?.credentials;
        const sdmUrl = SDMCredentials?.uri;

        LOG.info(`[INFO] SDM Plugin: Tenant Unsubscription started - ${tenant}`);

        try {
            const { repositoryId } = getConfigurations();
            if (!repositoryId) {
                LOG.warn('[WARN] Skipping offboarding because repositoryId is not configured');
                return;
            }
            const destination = await getDestination(subdomain);
            const allRepos = await listRepositories(sdmUrl, destination);
            const repoToOffboard = allRepos.find(
                repoInfo => repoInfo?.repository?.externalId === repositoryId
            );

            if (!repoToOffboard) {
                LOG.error(`[ERROR] SDM Plugin: Could not find a repository with externalId '${repositoryId}' for tenant ${tenant}.`);
            } else {
                const foundRepositoryId = repoToOffboard.repository.id;
                await offboardRepository(sdmUrl, foundRepositoryId, destination);
                LOG.info("[INFO] SDM repository offboarded");
            }
        } catch (err) {
            LOG.error('[FATAL] Error during SDM offboarding:', err);
            throw err;
        }
    });
    });
}