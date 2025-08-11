jest.mock('axios');
jest.mock('@sap/xssec');
jest.mock('../../../lib/util/index');
jest.mock('../../../lib/util/messageConsts', () => ({
    repositoryUrl: "/api/v1/repositories",
    repositoryMissing: "TEST: Repository Missing",
    repositoryConfigurationMissing: "TEST: SDM Config Missing",
}));

const path = require('path');

describe('SDM Plugin Onboarding Logic', () => {
    let axios, xssec, utils, mockCds, mockDeploymentService;

    beforeEach(() => {
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
        const MOCK_CONFIG_PATH = path.join(MOCK_CDS_ROOT, 'config.js');
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

        axios.post.mockResolvedValue({ status: 201, data: 'Repository onboarded' });
        xssec.requests.requestClientCredentialsToken.mockImplementation((_, __, ___, cb) => cb(null, 'mock-jwt-token'));
        utils.getConfigurations.mockReturnValue({ repositoryId: 'ext-12345' });

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
        jest.restoreAllMocks();
    });

    const triggerSubscribe = async (reqData) => {
        require('../../../lib/mtx/server');
        const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
        await listeningCallback();
        const subscribeCallback = mockDeploymentService.after.mock.calls.find(call => call[0] === 'subscribe')[1];
        await subscribeCallback({}, { data: reqData });
    };

    it('should successfully onboard a tenant repository on subscribe', async () => {
        const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
        const mockReqData = { tenant: 't1', metadata: { subscribedSubdomain: 'tenant-a-subdomain' } };
        await triggerSubscribe(mockReqData);
        const expectedRepoObject = {
            repository: {
                description: "A test repository",
                repositoryType: "com.sap.cloud.cmis.repository.ecm.system",
                isVersionEnabled: "true",
                externalId: 'ext-12345'
            }
        };
        expect(axios.post).toHaveBeenCalledWith(
            'https://mock-sdm-api.com/api/v1/repositories',
            expectedRepoObject,
            expect.any(Object)
        );
        expect(consoleLogSpy).toHaveBeenCalledWith('SDM repository onboarded');
    });

    it('should log an error if fetching the SDM token fails', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        xssec.requests.requestClientCredentialsToken.mockImplementation((_, __, ___, cb) => cb(new Error("UAA connection failed")));
        const mockReqData = { tenant: 't2', metadata: { subscribedSubdomain: 'tenant-b-subdomain' } };
        await triggerSubscribe(mockReqData);
        expect(axios.post).not.toHaveBeenCalled();
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM onboarding:", expect.any(Error));
    });

    it('should throw error if config.js is missing sdm key', () => {
        const MOCK_CDS_ROOT = path.resolve(__dirname, '../../..');
        const MOCK_CONFIG_PATH = path.join(MOCK_CDS_ROOT, 'config.js');
        jest.doMock(MOCK_CONFIG_PATH, () => ({}), { virtual: true });
        mockCds.env.profile = 'mtx-sidecar';
        jest.doMock('@sap/cds', () => mockCds);
        expect(() => require('../../../lib/mtx/server')).toThrow("TEST: SDM Config Missing");
    });

    it('should throw error if repositoryId or repositoryConfig is missing', async () => {
        utils.getConfigurations.mockReturnValue({}); // no repositoryId
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockReqData = { tenant: 't3', metadata: { subscribedSubdomain: 'tenant-c-subdomain' } };
        await triggerSubscribe(mockReqData);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM onboarding:", new Error("TEST: Repository Missing"));
    });

    it('should log error if onboardRepository fails', async () => {
        axios.post.mockRejectedValue({ response: { data: "POST failed" } });
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        const mockReqData = { tenant: 't4', metadata: { subscribedSubdomain: 'tenant-d-subdomain' } };
        await triggerSubscribe(mockReqData);
        expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM onboarding:", "POST failed");
    });

    it('should log error if cds.xt.DeploymentService connection fails', async () => {
        const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        mockCds.connect.to.mockResolvedValueOnce(null); // force connection failure

        require('../../../lib/mtx/server');
        const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
        await listeningCallback();

        expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to connect to cds.xt.DeploymentService");
    });
});
