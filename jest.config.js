let reporters = ['default'];
if (process.env.HTML_REPORT === 'true') {
    reporters.push([
        'jest-html-reporters',
        {
            openReport: true,
        },
    ]);
}

module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    globals: {
        'ts-jest': {
            ignoreCoverageForAllDecorators: true,
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
    moduleNameMapper: {
        '^~/(.*)$': '<rootDir>/src/$1',
    },
    reporters,
};
