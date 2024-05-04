const config = {
  verbose: true,
  testTimeout: 100000,
  testMatch: ["**/test/**/**/*.test.js"],
  collectCoverageFrom: ["**/lib/**/*"],
  coveragePathIgnorePatterns: ["node_modules", "<rootDir>/lib/persistence"],
  coverageReporters: ["lcov", "text", "text-summary"],
};

module.exports = config;
