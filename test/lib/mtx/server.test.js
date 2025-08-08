jest.mock('@sap/cds', () => ({
    env: { profile: 'mtx-sidecar', requires: { sdm: { credentials: { uri: 'http://sdm', uaa: {} } } } },
    root: '/mock/root',
    connect: { to: jest.fn() },
    on: jest.fn()
}));

jest.mock('@sap/xssec', () => ({
    requests: { requestClientCredentialsToken: jest.fn() }
}));

jest.mock('axios', () => ({
    post: jest.fn()
}));

jest.mock('path', () => ({
    join: jest.fn(() => '/mock/root/config.js')
}));

jest.mock('../util/index', () => ({
    getConfigurations: jest.fn()
}));

jest.mock('../util/messageConsts', () => ({
    repositoryUrl: '/repo',
    repositoryMissing: 'REPO_MISSING',
    repositoryConfigMissing: 'CONFIG_MISSING'
}));

// Mock config.js dynamically
jest.mock('/mock/root/config.js', () => ({
    sdm: { repositoryConfig: { foo: 'bar' } }
}), { virtual: true });

const cds = require('@sap/cds');
const { requests } = require('@sap/xssec');
const axios = require('axios');
const { getConfigurations } = require('../util/index');
const { repositoryMissing } = require('../util/messageConsts');

describe('server.js', () => {
    let server;

    beforeEach(() => {
        jest.clearAllMocks();
        jest.resetModules(); // Important for re-import
        server = require('../server');
    });

    describe('buildRepositoryObject', () => {
        it('should return repository object when config is valid', () => {
            getConfigurations.mockReturnValue({ repositoryId: 'id123' });
            const result = server.buildRepositoryObject();
            expect(result.repository.externalId).toBe('id123');
        });

        it('should throw error when repositoryId missing', () => {
            getConfigurations.mockReturnValue({ repositoryId: null });
            expect(() => server.buildRepositoryObject()).toThrow(repositoryMissing);
        });
    });

    describe('fetchSDMToken', () => {
        it('should resolve with token', async () => {
            requests.requestClientCredentialsToken.mockImplementation((sd, uaa, _n, cb) => {
                cb(null, 'token123');
            });
            await expect(server.fetchSDMToken('sub', {})).resolves.toBe('token123');
        });

        it('should reject on error', async () => {
            requests.requestClientCredentialsToken.mockImplementation((sd, uaa, _n, cb) => {
                cb(new Error('fail'));
            });
            await expect(server.fetchSDMToken('sub', {})).rejects.toThrow('fail');
        });
    });

    describe('onboardRepository', () => {
        it('should post repository and return response', async () => {
            axios.post.mockResolvedValue({ data: 'ok' });
            const res = await server.onboardRepository('http://sdm', { repository: {} }, 'tok');
            expect(res.data).toBe('ok');
        });

        it('should throw error on failure', async () => {
            axios.post.mockRejectedValue({ response: { data: 'err' } });
            await expect(server.onboardRepository('http://sdm', {}, 'tok')).rejects.toBe('err');
        });
    });

    describe('CDS event handlers', () => {
        it('should handle subscribe success', async () => {
            const afterHandlers = {};
            cds.connect.to.mockResolvedValue({
                after: (evt, cb) => { afterHandlers[evt] = cb; }
            });
            cds.on.mockImplementation((evt, cb) => cb());

            getConfigurations.mockReturnValue({ repositoryId: 'id123' });
            requests.requestClientCredentialsToken.mockImplementation((sd, uaa, _n, cb) => {
                cb(null, 'token123');
            });
            axios.post.mockResolvedValue({ data: 'ok' });

            require('../server');
            await afterHandlers.subscribe(null, {
                data: { tenant: 't1', metadata: { subscribedSubdomain: 'sub' } }
            });

            expect(axios.post).toHaveBeenCalled();
        });

        it('should handle subscribe with error', async () => {
            const afterHandlers = {};
            cds.connect.to.mockResolvedValue({
                after: (evt, cb) => { afterHandlers[evt] = cb; }
            });
            cds.on.mockImplementation((evt, cb) => cb());

            getConfigurations.mockReturnValue({ repositoryId: null });
            require('../server');
            await afterHandlers.subscribe(null, {
                data: { tenant: 't1', metadata: { subscribedSubdomain: 'sub' } }
            });
        });

        it('should handle unsubscribe', async () => {
            const afterHandlers = {};
            cds.connect.to.mockResolvedValue({
                after: (evt, cb) => { afterHandlers[evt] = cb; }
            });
            cds.on.mockImplementation((evt, cb) => cb());

            require('../server');
            const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
            await afterHandlers.unsubscribe(null, { data: { tenant: 't1' } });
            expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Tenant unsubscribed'));
        });
    });
});
