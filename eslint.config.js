/* eslint-env node */
const js = require('@eslint/js')
const react = require('eslint-plugin-react')
const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')

module.exports = [
  {
    ignores: [
      'node_modules/**',
      'build/**',
      'client/build/**',
      'server/dist/**',
      'shared/dist/**',
      'tools/sony-contract-bot/dist/**',
      'coverage/**',
      '**/*.config.js',
      '**/*.config.ts',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: __dirname,
      },
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        window: 'readonly',
        document: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      ...tsPlugin.configs['strict-type-checked'].rules,
      'no-undef': 'off',
    },
  },
  {
    files: ['client/src/**/*.tsx'],
    plugins: {
      react,
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
    },
  },
  {
    // The `@effect/platform` HttpApi surface is confined to exactly three server
    // modules (the typed API definition, its handlers, and the HTTP composition
    // root). Everything else — domain, services, the Sony client — stays
    // framework-free so the interface layer never couples to transport
    // internals (CLAUDE.md → Architecture; STACK.md §0 layering). CI gate.
    files: ['server/src/**/*.ts'],
    ignores: [
      'server/src/api/gamesApi.ts',
      'server/src/api/gamesHandlers.ts',
      'server/src/http/server.ts',
      // The app integration test boots the API through the platform web handler.
      'server/src/__tests__/app.test.ts',
    ],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@effect/platform', '@effect/platform/*', '@effect/platform-node', '@effect/platform-node/*'],
              message:
                'Import @effect/platform only from api/gamesApi.ts, api/gamesHandlers.ts, or http/server.ts (HttpApi is confined to the interface layer).',
            },
          ],
        },
      ],
    },
  },
  {
    // Test files contain async mock implementations that match the signature
    // of the function they replace, but their bodies have no `await`. That is
    // idiomatic for vi.fn mocks; relax `require-await` here.
    files: ['**/__tests__/**/*.{ts,tsx}', '**/*.test.{ts,tsx}'],
    rules: {
      '@typescript-eslint/require-await': 'off',
    },
  },
]
