module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    transform: {
        '^.+\\.ts?$': [
            'ts-jest',
            {
                ignoreCoverageForAllDecorators: true,
                tsconfig: 'tsconfig.test.json',
            },
        ],
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
};
