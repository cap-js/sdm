// Jest setup file to suppress console output during tests

// Store original console methods
global.originalConsole = {
  log: console.log,
  warn: console.warn,
  error: console.error,
  info: console.info
};

// Mock console methods to suppress output during tests
global.console = {
  ...console,
  // Uncomment the line below if you also want to suppress console.log
  // log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  info: jest.fn()
};

// Optional: Add a helper to restore console for specific tests if needed
global.restoreConsole = () => {
  console.warn = global.originalConsole.warn;
  console.error = global.originalConsole.error;
  console.info = global.originalConsole.info;
  console.log = global.originalConsole.log;
};

// Optional: Add a helper to check console calls in tests
global.getConsoleCalls = () => ({
  warn: console.warn.mock.calls,
  error: console.error.mock.calls,
  info: console.info.mock.calls
});
