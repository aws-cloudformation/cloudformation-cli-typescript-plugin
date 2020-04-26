module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    globals: {
        'ts-jest': {
            diagnostics: false, // Necessary to avoid typeschecking error in decorators
        },
    },
    testRegex: '\\.test.ts$',
    coverageThreshold: {
        global: {
            branches: 80,
            statements: 90,
        },
    },
    collectCoverage: true,
    coverageReporters: ['lcov', 'html', 'text-summary'],
};
