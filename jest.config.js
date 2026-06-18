const config = {
  verbose: true,
  testTimeout: 100000,
  forceExit: true,
  testMatch: ["**/test/lib/**/*.test.js"],
  collectCoverageFrom: ["**/lib/**/*"],
  coveragePathIgnorePatterns: ["node_modules", "<rootDir>/lib/persistence"],
  coverageReporters: ["lcov", "text", "text-summary"],
  coverageThreshold: {
    global: {
      branches: 90,
      lines: 90,
      statements: 90,
      functions: 90
    },
  },
  // Setup file to suppress console output during tests
  setupFilesAfterEnv: ["<rootDir>/test/setup.js"]
};

module.exports = config;
