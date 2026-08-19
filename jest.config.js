/** @type {import('jest').Config} */
const config = {
    testEnvironment: "node",

    // ESM support
    transform: {},

    // Test file patterns
    testMatch: ["**/src/tests/**/*.test.js"],

    // Setup files
    setupFilesAfterEnv: ["<rootDir>/src/tests/setup.js"],

    // Coverage
    collectCoverageFrom: [
        "src/services/payment.service.js",
        "src/services/payment-reconciliation.service.js",
        "src/controllers/payment.controller.js",
        "src/routes/payment.routes.js",
        "src/utils/logger.js",
        "src/middlewares/correlation.middleware.js",
    ],

    coverageDirectory: "coverage",

    coverageReporters: ["text", "lcov"],

    // Timeout for integration tests
    testTimeout: 30000,

    // Force exit to handle MongoDB memory server cleanup
    forceExit: true,

    // Detect open handles
    detectOpenHandles: true,

    // Verbose output
    verbose: true,

    // Clear cache
    cache: false,
};

export default config;