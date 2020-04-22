module.exports = {
    env: {
        jest: true,
        node: true,
    },
    plugins: [
        '@typescript-eslint',
        'import',
        'prefer-arrow',
    ],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: '2017',
        sourceType: 'module',
        project: './tsconfig.eslint.json',
    },
    extends: [
        'plugin:import/typescript',
        'plugin:@typescript-eslint/recommended',
    ],
    settings: {
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.tsx'],
        },
        'import/resolver': {
            node: {},
            typescript: {
                directory: './tsconfig.eslint.json',
            }
        }
    },
    ignorePatterns: ['*.js', '*.d.ts', 'node_modules/', '*.generated.ts'],
    rules: {
        // Require use of the `import { foo } from 'bar';` form instead of `import foo = require('bar');`
        '@typescript-eslint/no-require-imports': ['error'],
        '@typescript-eslint/indent': ['error', 4],

        // Style
        'quotes': ['error', 'single', { avoidEscape: true }],
        // ensures clean diffs,
        // see https://medium.com/@nikgraf/why-you-should-enforce-dangling-commas-for-multiline-statements-d034c98e36f8
        'comma-dangle': ['error', 'always-multiline'],
        // Require all imported dependencies are actually declared in package.json
        'import/no-extraneous-dependencies': ['error'],
        'import/no-unresolved': ['error'],

        '@typescript-eslint/ban-ts-ignore': ['warn'],
        '@typescript-eslint/no-empty-function': ['warn'],
    }
}
