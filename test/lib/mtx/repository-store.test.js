const fs = require('fs');
const path = require('path');

const { saveRepositoryId, getRepositoryId } = require('../../../lib/mtx/repository-store');

const STORE_PATH = path.join(__dirname, '../../../lib/mtx/repository-map.json');

beforeEach(() => {
    if (fs.existsSync(STORE_PATH)) {
        fs.unlinkSync(STORE_PATH);
    }
});

describe('Repository Store', () => {
    test('should save and retrieve repository ID for a tenant', () => {
        saveRepositoryId('tenant1', 'repo-123');
        const repoId = getRepositoryId('tenant1');
        expect(repoId).toBe('repo-123');
    });

    test('should overwrite repository ID if tenant already exists', () => {
        saveRepositoryId('tenant1', 'repo-123');
        saveRepositoryId('tenant1', 'repo-456');
        const repoId = getRepositoryId('tenant1');
        expect(repoId).toBe('repo-456');
    });

    test('should return undefined for non-existing tenant', () => {
        const repoId = getRepositoryId('unknownTenant');
        expect(repoId).toBeUndefined();
    });

    test('should persist data across multiple writes', () => {
        saveRepositoryId('tenant1', 'repo-111');
        saveRepositoryId('tenant2', 'repo-222');

        const repo1 = getRepositoryId('tenant1');
        const repo2 = getRepositoryId('tenant2');

        expect(repo1).toBe('repo-111');
        expect(repo2).toBe('repo-222');
    });

    test('should create repository-map.json if it does not exist', () => {
        if (fs.existsSync(STORE_PATH)) {
            fs.unlinkSync(STORE_PATH);
        }
        expect(fs.existsSync(STORE_PATH)).toBe(false);

        saveRepositoryId('tenant1', 'repo-123');

        expect(fs.existsSync(STORE_PATH)).toBe(true);
        const repoId = getRepositoryId('tenant1');
        expect(repoId).toBe('repo-123');
    });
});
