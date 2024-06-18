const config = {
  verbose: true,
  testTimeout: 100000,
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
  }
};

module.exports = config;
