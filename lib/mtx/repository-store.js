const fs = require('fs');
const path = require('path');

const STORE_PATH = path.join(__dirname, 'repository-map.json');

const readStore = () => {
    if (!fs.existsSync(STORE_PATH)) {
        fs.writeFileSync(STORE_PATH, '{}');
    }
    return JSON.parse(fs.readFileSync(STORE_PATH));
};

const writeStore = (data) => {
    fs.writeFileSync(STORE_PATH, JSON.stringify(data, null, 2));
};

// Save repository ID per tenant
const saveRepositoryId = (tenant, repoId) => {
    const store = readStore();
    store[tenant] = repoId;
    writeStore(store);
};

// Retrieve repository ID for tenant
const getRepositoryId = (tenant) => {
    const store = readStore();
    return store[tenant];
};

module.exports = { saveRepositoryId, getRepositoryId };
