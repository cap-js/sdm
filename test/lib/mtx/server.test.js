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

    beforeEach(() => {
        jest.resetModules();
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
    });

    describe('Service Initialization', () => {
        it('should log an error if the connection to DeploymentService fails', async () => { /* ... unchanged ... */ });
        it('should throw an error if SDMRepositoryConfig.js is invalid', () => { /* ... unchanged ... */ });
    });

    describe('Onboarding and Offboarding', () => {
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
            it('should successfully onboard a tenant repository on subscribe', async () => { /* ... unchanged ... */ });
            it('should throw an error if buildRepositoryObject throws an error (repositoryId not found)', async () => { /* ... unchanged ... */ });
            it('should throw an error if fetching the SDM token fails', async () => { /* ... unchanged ... */ });
        });

        describe('Offboarding Logic', () => {
            // +++ TEST IMPROVED +++
            it('should successfully discover and offboard a tenant repository on unsubscribe', async () => {
                const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
                const subscribeReqData = { tenant: 't5', metadata: { subscribedSubdomain: 'tenant-e-subdomain' } };
                await subscribeCallback({}, { data: subscribeReqData });
                await unsubscribeCallback({}, { data: { tenant: 't5' } });

                expect(axios.delete).toHaveBeenCalledWith(expect.stringContaining(MOCK_DISCOVERED_ID), expect.any(Object));
                expect(consoleLogSpy).toHaveBeenCalledWith("SDM repository offboarded");
                consoleLogSpy.mockRestore();
            });

            it('should log an error if the repository to offboard is not found', async () => { /* ... unchanged ... */ });

            it('should throw an error if fetching the SDM token fails during offboarding', async () => { /* ... unchanged ... */ });

            it('should return early if repositoryId is not found during unsubscribe', async () => {
                const subscribeReqData = { tenant: 't10', metadata: { subscribedSubdomain: 'tenant-j-subdomain' } };
                await subscribeCallback({}, { data: subscribeReqData });
                utils.getConfigurations.mockReturnValue({});
                await unsubscribeCallback({}, { data: { tenant: 't10' } });
                expect(axios.get).not.toHaveBeenCalled();
                expect(axios.delete).not.toHaveBeenCalled();
            });

            it('should delete the tenant from the store after unsubscribing', async () => {
                const tenantId = 't11';
                const subscribeReqData = { tenant: tenantId, metadata: { subscribedSubdomain: 'tenant-k-subdomain' } };
                await subscribeCallback({}, { data: subscribeReqData });
                await unsubscribeCallback({}, { data: { tenant: tenantId } });
                expect(axios.delete).toHaveBeenCalledTimes(1);
                axios.delete.mockClear();
                await unsubscribeCallback({}, { data: { tenant: tenantId } });
                expect(axios.delete).not.toHaveBeenCalled();
            });
        });
    });
});