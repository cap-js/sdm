jest.mock('axios');
jest.mock('@sap/xssec');
jest.mock('../../../lib/util/index');
const path = require('path');
const messageConsts = require('../../../lib/util/messageConsts');

describe('SDM Plugin Onboarding and Offboarding Logic', () => {
    let axios, xssec, utils, mockCds, mockDeploymentService, mockRepoStore;
    let subscribeCallback, unsubscribeCallback;

    const MOCK_EXTERNAL_ID = 'ext-12345';
    const MOCK_DISCOVERED_ID = 'discovered-repo-id-abc';

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

        axios.post.mockResolvedValue({ status: 201, data: { id: 'onboard-123' } });
        axios.delete.mockResolvedValue({ status: 204 });
        axios.get.mockResolvedValue({
            data: {
                repoAndConnectionInfos: [
                    { repository: { id: 'some-other-repo', externalId: 'other-ext-id' } },
                    { repository: { id: MOCK_DISCOVERED_ID, externalId: MOCK_EXTERNAL_ID } }
                ]
            }
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
    });

    describe('Service Initialization', () => {
        it('should log an error if the connection to DeploymentService fails', async () => {
            const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

            mockCds.connect.to.mockResolvedValue(null);

            require('../../../lib/mtx/server');
            const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
            await listeningCallback();

            expect(consoleErrorSpy).toHaveBeenCalledWith("Failed to connect to cds.xt.DeploymentService");
            expect(mockDeploymentService.after).not.toHaveBeenCalled();

            consoleErrorSpy.mockRestore();
        });
    });

    describe('Onboarding and Offboarding', () => {
        // This nested beforeEach runs the successful initialization for this group of tests
        beforeEach(async () => {
            require('../../../lib/mtx/server');
            const listeningCallback = mockCds.on.mock.calls.find(call => call[0] === 'listening')[1];
            await listeningCallback();

            const subscribeCall = mockDeploymentService.after.mock.calls.find(call => call[0] === 'subscribe');
            subscribeCallback = subscribeCall[1];

            const unsubscribeCall = mockDeploymentService.after.mock.calls.find(call => call[0] === 'unsubscribe');
            unsubscribeCallback = unsubscribeCall[1];
        });

        describe('Onboarding Logic', () => {
            it('should successfully onboard a tenant repository on subscribe', async () => {
                const mockReqData = { tenant: 't1', metadata: { subscribedSubdomain: 'tenant-a-subdomain' } };
                await subscribeCallback({}, { data: mockReqData });
                expect(axios.post).toHaveBeenCalledWith(expect.any(String), expect.any(Object), expect.any(Object));
            });

            it('should log an error if buildRepositoryObject throws an error', async () => {
                const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
                utils.getConfigurations.mockReturnValue({ repositoryId: null });
                const mockReqData = { tenant: 't-build-fail', metadata: { subscribedSubdomain: 'sub-build-fail' } };
                await subscribeCallback({}, { data: mockReqData });
                expect(consoleErrorSpy).toHaveBeenCalledWith("Error during SDM onboarding:", new Error(messageConsts.repositoryMissing));
                consoleErrorSpy.mockRestore();
            });
        });

        describe('Offboarding Logic', () => {
            it('should successfully discover and offboard a tenant repository on unsubscribe', async () => {
                const subscribeReqData = { tenant: 't5', metadata: { subscribedSubdomain: 'tenant-e-subdomain' } };
                const unsubscribeReqData = { tenant: 't5' };
                await subscribeCallback({}, { data: subscribeReqData });
                await unsubscribeCallback({}, { data: unsubscribeReqData });
                expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining(MOCK_DISCOVERED_ID), expect.any(Object));
            });

            it('should return early if tenant info is not in the store', async () => {
                const mockReqData = { tenant: 't8-never-subscribed' };
                await unsubscribeCallback({}, { data: mockReqData });
                expect(axios.get).not.toHaveBeenCalled();
            });

            it('should log a warning if the repository to offboard is not found', async () => {
                const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
                axios.get.mockResolvedValue({ data: { repoAndConnectionInfos: [] } });
                const subscribeReqData = { tenant: 't9', metadata: { subscribedSubdomain: 'tenant-i-subdomain' } };
                await subscribeCallback({}, { data: subscribeReqData });
                await unsubscribeCallback({}, { data: { tenant: 't9' } });
                expect(consoleWarnSpy).toHaveBeenCalledWith(expect.stringContaining(`Could not find a repository with externalId '${MOCK_EXTERNAL_ID}'`));
                expect(axios.delete).not.toHaveBeenCalled();
                consoleWarnSpy.mockRestore();
            });

            it('should throw an error if fetching the SDM token fails during offboarding', async () => {
                const tokenError = new Error("UAA connection failed");
                // Succeed on 1st call (subscribe), fail on 2nd (unsubscribe)
                xssec.v3.requests.requestClientCredentialsToken
                    .mockImplementationOnce((_, __, ___, cb) => cb(null, 'mock-successful-token-for-subscribe'))
                    .mockImplementationOnce((_, __, ___, cb) => cb(tokenError));

                const subscribeReqData = { tenant: 't-off-token-fail', metadata: { subscribedSubdomain: 'sub-off-token-fail' } };
                await subscribeCallback({}, { data: subscribeReqData });

                await expect(unsubscribeCallback({}, { data: { tenant: 't-off-token-fail' } })).rejects.toThrow(tokenError);
            });
        });
    });
});