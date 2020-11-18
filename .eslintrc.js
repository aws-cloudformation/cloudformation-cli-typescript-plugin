module.exports = {
    env: {
        jest: true,
        node: true,
    },
    plugins: ['@typescript-eslint', 'prettier', 'import', 'prefer-arrow'],
    parser: '@typescript-eslint/parser',
    parserOptions: {
        ecmaVersion: '2017',
        sourceType: 'module',
        project: './tsconfig.eslint.json',
    },
    extends: [
        'plugin:import/typescript',
        'plugin:@typescript-eslint/recommended',
        'plugin:prettier/recommended',
    ],
    settings: {
        'import/parsers': {
            '@typescript-eslint/parser': ['.ts', '.tsx'],
        },
        'import/resolver': {
            node: {},
            typescript: {
                directory: './tsconfig.eslint.json',
            },
        },
    },
    ignorePatterns: ['*.d.ts', '*.generated.ts'],
    rules: {
        // Require use of the `import { foo } from 'bar';` form instead of `import foo = require('bar');`
        '@typescript-eslint/no-require-imports': ['error'],

        '@typescript-eslint/ban-ts-ignore': ['warn'],
        '@typescript-eslint/no-empty-function': ['warn'],

        // Require all imported dependencies are actually declared in package.json
        'import/no-extraneous-dependencies': ['error'],
        'import/no-unresolved': ['error'],
    },
    overrides: [
        {
            files: ['*.js', '*.jsx'],
            rules: {
                '@typescript-eslint/explicit-function-return-type': 'off',
                '@typescript-eslint/no-unused-vars': 'off',
                '@typescript-eslint/no-var-requires': 'off',
                '@typescript-eslint/no-require-imports': 'off',
            }
        }
    ],
};
