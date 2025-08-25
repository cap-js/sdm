jest.mock('axios');
jest.mock('@sap/xssec');
jest.mock('../../../lib/util/index');
const path = require('path');
const messageConsts = require('../../../lib/util/messageConsts');

describe('SDM Plugin Onboarding and Offboarding Logic', () => {
    let axios, xssec, utils, mockCds, mockDeploymentService;
    let subscribeCallback, unsubscribeCallback;
    const MOCK_EXTERNAL_ID = 'ext-12345';
    const MOCK_DISCOVERED_ID = 'discovered-repo-id-abc';
    let consoleErrorSpy, consoleLogSpy;

    beforeEach(() => {
        jest.resetModules();
        consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const MOCK_CONFIG = { sdm: { repositoryConfig: { description: "A test repository" } } };
        const MOCK_CDS_ROOT = path.resolve(__dirname, '../../..');
        const MOCK_CONFIG_PATH = path.join(MOCK_CDS_ROOT, 'SDMRepositoryConfig.js');
        const MOCK_CDS_ENV = {
            profile: 'mtx-sidecar',
            root: MOCK_CDS_ROOT,
            requires: { sdm: { credentials: { uri: 'https://mock-sdm-api.com', uaa: {} } } },
        };
        axios = require('axios');
        xssec = require('@sap/xssec');
        utils = require('../../../lib/util/index');
        axios.post.mockResolvedValue({ status: 201, data: { id: 'onboard-123' } });
        axios.delete.mockResolvedValue({ status: 204 });
        axios.get.mockResolvedValue({
            data: { repoAndConnectionInfos: [{ repository: { id: MOCK_DISCOVERED_ID, externalId: MOCK_EXTERNAL_ID } }] }
        });
        xssec.v3.requests.requestClientCredentialsToken.mockImplementation((_, __, ___, cb) => cb(null, 'mock-jwt-token'));
        utils.getConfigurations.mockReturnValue({ repositoryId: MOCK_EXTERNAL_ID });
        mockDeploymentService = { after: jest.fn() };
        mockCds = {
            connect: { to: jest.fn().mockResolvedValue(mockDeploymentService) },
            on: jest.fn(),
            env: MOCK_CDS_ENV,
            root: MOCK_CDS_ENV.root,
        };
        jest.doMock(MOCK_CONFIG_PATH, () => MOCK_CONFIG, { virtual: true });
        jest.doMock('@sap/cds', () => mockCds);
    });

    afterEach(() => {
        jest.clearAllMocks();
        consoleErrorSpy.mockRestore();
        consoleLogSpy.mockRestore();
    });

    describe('Service Initialization', () => {
        it('should log an error if the connection to DeploymentService fails', async () => {
            mockCds.connect.to.mockResolvedValue(null);
            require('../../../lib/mtx/server');
            const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
            await listeningCallback();
            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to connect to cds.xt.DeploymentService");
        });

        it('should throw an error if SDMRepositoryConfig.js is invalid', () => {
            const MOCK_CDS_ROOT = path.resolve(__dirname, '../../..');
            const MOCK_CONFIG_PATH = path.join(MOCK_CDS_ROOT, 'SDMRepositoryConfig.js');
            jest.doMock(MOCK_CONFIG_PATH, () => ({}), { virtual: true });
            const badCds = { env: { profile: 'mtx-sidecar' }, root: MOCK_CDS_ROOT, on: jest.fn(), connect: { to: jest.fn() } };
            jest.doMock('@sap/cds', () => badCds);
            expect(() => require('../../../lib/mtx/server')).toThrow(messageConsts.repositoryConfigurationMissing);
        });
    });

    describe('Onboarding and Offboarding', () => {
        beforeEach(async () => {
            require('../../../lib/mtx/server');
            const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
            await listeningCallback();
            subscribeCallback = mockDeploymentService.after.mock.calls.find(call => call[0] === 'subscribe')[1];
            unsubscribeCallback = mockDeploymentService.after.mock.calls.find(call => call[0] === 'unsubscribe')[1];
        });

        describe('Onboarding Logic', () => {
            it('should successfully onboard a tenant repository on subscribe', async () => {
                const req = { data: { tenant: 't1', metadata: { subscribedSubdomain: 'tenant-a-subdomain' } } };
                await subscribeCallback({}, req);
                expect(axios.post).toHaveBeenCalled();
            });

            it('should throw if buildRepositoryObject fails', async () => {
                utils.getConfigurations.mockReturnValue({});
                const req = { data: { tenant: 't2', metadata: { subscribedSubdomain: 'tenant-b-subdomain' } } };
                await expect(subscribeCallback({}, req)).rejects.toThrow(messageConsts.repositoryMissing);
            });

            it('should throw if fetching token fails', async () => {
                xssec.v3.requests.requestClientCredentialsToken.mockImplementation((_, __, ___, cb) => cb(new Error("token fail")));
                const req = { data: { tenant: 't3', metadata: { subscribedSubdomain: 'tenant-c-subdomain' } } };
                await expect(subscribeCallback({}, req)).rejects.toThrow("token fail");
            });

            it('should throw if onboarding (axios.post) fails', async () => {
                axios.post.mockRejectedValue(new Error("post fail"));
                const req = { data: { tenant: 't4', metadata: { subscribedSubdomain: 'tenant-d-subdomain' } } };
                await expect(subscribeCallback({}, req)).rejects.toThrow("post fail");
            });
        });

        describe('Offboarding Logic', () => {
            it('should offboard a tenant repository on unsubscribe', async () => {
                const req = { data: { tenant: 't5', metadata: { subscribedSubdomain: 'tenant-e-subdomain' } } };
                await subscribeCallback({}, req);
                await unsubscribeCallback({}, { data: { tenant: 't5' } });
                expect(axios.delete).toHaveBeenCalled();
            });

            it('should log error if repo not found during offboard', async () => {
                axios.get.mockResolvedValue({ data: { repoAndConnectionInfos: [] } });
                const req = { data: { tenant: 't6', metadata: { subscribedSubdomain: 'tenant-f-subdomain' } } };
                await subscribeCallback({}, req);
                await unsubscribeCallback({}, { data: { tenant: 't6' } });
                expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("Could not find a repository"));
            });

            it('should throw if listing repositories fails', async () => {
                axios.get.mockRejectedValue(new Error("list fail"));
                const req = { data: { tenant: 't8', metadata: { subscribedSubdomain: 'tenant-h-subdomain' } } };
                await subscribeCallback({}, req);
                await expect(unsubscribeCallback({}, { data: { tenant: 't8' } })).rejects.toThrow("list fail");
            });

            it('should throw if delete fails', async () => {
                axios.delete.mockRejectedValue(new Error("delete fail"));
                const req = { data: { tenant: 't9', metadata: { subscribedSubdomain: 'tenant-i-subdomain' } } };
                await subscribeCallback({}, req);
                await expect(unsubscribeCallback({}, { data: { tenant: 't9' } })).rejects.toThrow("delete fail");
            });

            it('should return early if repositoryId missing', async () => {
                const tenantId = 't10';
                await subscribeCallback({}, { data: { tenant: tenantId, metadata: { subscribedSubdomain: 'tenant-j' } } });
                utils.getConfigurations.mockReturnValue({});
                await unsubscribeCallback({}, { data: { tenant: tenantId } });
                expect(axios.get).not.toHaveBeenCalled();
            });

            it('should delete tenant from store', async () => {
                const tenantId = 't11';
                await subscribeCallback({}, { data: { tenant: tenantId, metadata: { subscribedSubdomain: 'tenant-k' } } });
                await unsubscribeCallback({}, { data: { tenant: tenantId } });
                expect(axios.delete).toHaveBeenCalledTimes(1);
                axios.delete.mockClear();
                await unsubscribeCallback({}, { data: { tenant: tenantId } });
                expect(axios.delete).not.toHaveBeenCalled();
            });
        });
    });
});