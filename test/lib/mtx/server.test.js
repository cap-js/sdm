jest.mock('axios');
jest.mock('@sap/xssec');
jest.mock('../../../lib/util/index');
jest.mock('../../../lib/mtx/repository-store');
const path = require('path');
const messageConsts = require('../../../lib/util/messageConsts');

describe('SDM Plugin Onboarding and Offboarding Logic', () => {
    let axios, xssec, utils, mockCds, mockDeploymentService, mockRepoStore;
    let subscribeCallback, unsubscribeCallback;

    beforeEach(async () => {
        jest.resetModules();

        const MOCK_CONFIG = {
            sdm: {
                repositoryConfig: {
                    description: "A test repository",
                    repositoryType: "com.sap.cloud.cmis.repository.ecm.system",
                    isVersionEnabled: "true",
                },
            },
        };

        const MOCK_CDS_ROOT = path.resolve(__dirname, '../../..');
        const MOCK_CONFIG_PATH = path.join(MOCK_CDS_ROOT, 'SDMRepositoryConfig.js');
        const MOCK_CDS_ENV = {
            profile: 'mtx-sidecar',
            root: MOCK_CDS_ROOT,
            requires: {
                sdm: {
                    credentials: {
                        uri: 'https://mock-sdm-api.com',
                        uaa: {},
                    },
                },
            },
        };

        axios = require('axios');
        xssec = require('@sap/xssec');
        utils = require('../../../lib/util/index');
        mockRepoStore = require('../../../lib/mtx/repository-store');

        axios.post.mockResolvedValue({ status: 201, data: { id: 'onboard-123' } });
        axios.delete.mockResolvedValue({ status: 204, data: 'Repository offboarded' });
        xssec.v3.requests.requestClientCredentialsToken.mockImplementation((_, __, ___, cb) => cb(null, 'mock-jwt-token'));
        utils.getConfigurations.mockReturnValue({ repositoryId: 'ext-12345' });
        mockRepoStore.getRepositoryId.mockReturnValue({ repositoryId: 'onboard-123', subdomain: 'mock-subdomain' });

        mockDeploymentService = { after: jest.fn() };

        mockCds = {
            connect: { to: jest.fn().mockResolvedValue(mockDeploymentService) },
            on: jest.fn(),
            env: MOCK_CDS_ENV,
            root: MOCK_CDS_ENV.root,
        };

        jest.doMock(MOCK_CONFIG_PATH, () => MOCK_CONFIG, { virtual: true });
        jest.doMock('@sap/cds', () => mockCds);

        require('../../../lib/mtx/server');

        const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
        await listeningCallback();

        expect(mockDeploymentService.after).toHaveBeenCalledTimes(2);

        const subscribeCall = mockDeploymentService.after.mock.calls.find(call => call[0] === 'subscribe');
        const unsubscribeCall = mockDeploymentService.after.mock.calls.find(call => call[0] === 'unsubscribe');

        if (!subscribeCall || typeof subscribeCall[1] !== 'function') {
            throw new Error("Failed to find 'subscribe' callback.");
        }
        if (!unsubscribeCall || typeof unsubscribeCall[1] !== 'function') {
            throw new Error("Failed to find 'unsubscribe' callback.");
        }

        subscribeCallback = subscribeCall[1];
        unsubscribeCallback = unsubscribeCall[1];
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.restoreAllMocks();
    });

    describe('Onboarding Logic', () => {
        // ... (Onboarding tests are correct and unchanged) ...
        it('should successfully onboard a tenant repository and save its ID on subscribe', async () => {
            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            const mockReqData = { tenant: 't1', metadata: { subscribedSubdomain: 'tenant-a-subdomain' } };

            await subscribeCallback({}, { data: mockReqData });

            const expectedRepoObject = {
                repository: {
                    description: "A test repository",
                    repositoryType: "com.sap.cloud.cmis.repository.ecm.system",
                    isVersionEnabled: "true",
                    externalId: 'ext-12345'
                }
            };
            expect(axios.post).toHaveBeenCalledWith(
                `https://mock-sdm-api.com${messageConsts.repositoryUrl}`,
                expectedRepoObject,
                expect.any(Object)
            );
            expect(mockRepoStore.saveRepositoryId).toHaveBeenCalledWith('t1', {
                repositoryId: 'onboard-123',
                subdomain: 'tenant-a-subdomain'
            });
            expect(consoleLogSpy).toHaveBeenCalledWith('SDM repository onboarded');
        });

        it('should log an error if fetching the SDM token fails', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            xssec.v3.requests.requestClientCredentialsToken.mockImplementationOnce((_, __, ___, cb) => cb(new Error("UAA connection failed")));
            const mockReqData = { tenant: 't2', metadata: { subscribedSubdomain: 'tenant-b-subdomain' } };

            await subscribeCallback({}, { data: mockReqData });

            expect(axios.post).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM onboarding:", expect.any(Error));
        });

        it('should throw error if SDMRepositoryConfig.js is missing sdm key', () => {
            const MOCK_CDS_ROOT = path.resolve(__dirname, '../../..');
            const MOCK_CONFIG_PATH = path.join(MOCK_CDS_ROOT, 'SDMRepositoryConfig.js');
            jest.resetModules();
            jest.doMock(MOCK_CONFIG_PATH, () => ({}), { virtual: true });
            mockCds.env.profile = 'mtx-sidecar';
            jest.doMock('@sap/cds', () => mockCds);

            expect(() => require('../../../lib/mtx/server')).toThrow(messageConsts.repositoryConfigurationMissing);
        });

        it('should log error if repositoryId or repositoryConfig is missing', async () => {
            utils.getConfigurations.mockReturnValue({});
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const mockReqData = { tenant: 't3', metadata: { subscribedSubdomain: 'tenant-c-subdomain' } };

            await subscribeCallback({}, { data: mockReqData });

            expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM onboarding:", new Error(messageConsts.repositoryMissing));
        });

        it('should log error if onboardRepository fails', async () => {
            axios.post.mockRejectedValueOnce({ response: { data: "POST failed" } });
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const mockReqData = { tenant: 't4', metadata: { subscribedSubdomain: 'tenant-d-subdomain' } };

            await subscribeCallback({}, { data: mockReqData });

            expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM onboarding:", "POST failed");
        });

        it('should log error if cds.xt.DeploymentService connection fails', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            mockCds.connect.to.mockResolvedValueOnce(null);

            jest.resetModules();
            require('../../../lib/mtx/server');

            const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
            await listeningCallback();

            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to connect to cds.xt.DeploymentService");
        });
    });

    describe('Offboarding Logic', () => {
        it('should successfully offboard a tenant repository on unsubscribe', async () => {
            const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            const mockReqData = { tenant: 't5' };

            await unsubscribeCallback({}, { data: mockReqData });

            expect(axios.delete).toHaveBeenCalledWith(
                `https://mock-sdm-api.com${messageConsts.repositoryUrl}/onboard-123`,
                { headers: { 'Authorization': 'Bearer mock-jwt-token' } }
            );
            expect(consoleLogSpy).toHaveBeenCalledWith('SDM repository offboarded');
        });

        it('should throw an error if fetching the SDM token fails during offboarding', async () => {
            xssec.v3.requests.requestClientCredentialsToken.mockImplementationOnce((_, __, ___, cb) => cb(new Error("UAA connection failed")));
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const mockReqData = { tenant: 't6' };

            await expect(unsubscribeCallback({}, { data: mockReqData })).rejects.toThrow("UAA connection failed");

            expect(axios.delete).not.toHaveBeenCalled();
            expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM offboarding:", expect.any(Error));
        });

        it('should throw an error if offboardRepository fails', async () => {
            const deleteError = { response: { data: "DELETE failed" } };
            axios.delete.mockRejectedValueOnce(deleteError);

            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const mockReqData = { tenant: 't7' };

            // --- THIS IS THE FIX ---
            // We expect the promise to reject with the unwrapped string, not the original error object.
            await expect(unsubscribeCallback({}, { data: mockReqData })).rejects.toEqual("DELETE failed");

            expect(axios.delete).toHaveBeenCalledTimes(1);
            expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM offboarding:", "DELETE failed");
        });

        it('should return early if repositoryId is missing during offboarding', async () => {
            mockRepoStore.getRepositoryId.mockReturnValueOnce(null);
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const mockReqData = { tenant: 't8' };

            await expect(unsubscribeCallback({}, { data: mockReqData })).resolves.toBeUndefined();

            expect(axios.delete).not.toHaveBeenCalled();
            expect(consoleErrorSpy).not.toHaveBeenCalled();
        });
    });
});