module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    globals: {
        'ts-jest': {
            diagnostics: false, // Necessary to avoid typeschecking error in decorators
        },
    },
    testRegex: '\\.test.ts$',
    testRunner: 'jest-circus/runner',
    coverageThreshold: {
        global: {
            branches: 70,
            statements: 80,
        },
    },
    coverageDirectory: 'coverage/ts',
    collectCoverage: true,
    coverageReporters: ['json', 'lcov', 'text'],
    coveragePathIgnorePatterns: ['/node_modules/', '/tests/data/'],
    testTimeout: 60000,
};
