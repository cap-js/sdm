const config = {
  verbose: true,
  testTimeout: 100000,
  testMatch: ['**/test/*.test.js'],
  collectCoverageFrom: [
    '**/lib/*',
    '**/srv/*',
    '**/cds-plugin.js'
  ],
  coverageReporters: ['lcov', 'text', 'text-summary'],
};

module.exports = config;
