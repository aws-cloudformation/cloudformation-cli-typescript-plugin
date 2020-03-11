module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  globals: {
    'ts-jest': {
      diagnostics: false, // Necessary to avoid typeschecking error in decorators
    }
  },
  testRegex: '\\.test.ts$',
};
