// Flat ESLint config migrated from package.json eslintConfig
// Note: Requires ESLint 8.21+ (preferably 9+). With current deps (ESLint 7),
// this file will be ignored. Upgrade ESLint to use flat config.

/* eslint-env node */
const js = require('@eslint/js')
const react = require('eslint-plugin-react')
const tsParser = require('@typescript-eslint/parser')
const tsPlugin = require('@typescript-eslint/eslint-plugin')

// Safely extract recommended rule sets from plugins (older versions may differ)
const tsRecommendedRules =
  (tsPlugin.configs &&
    tsPlugin.configs.recommended &&
    tsPlugin.configs.recommended.rules) ||
  {}
const tsEslintCompatRules =
  (tsPlugin.configs &&
    tsPlugin.configs['eslint-recommended'] &&
    tsPlugin.configs['eslint-recommended'].rules) ||
  {}
const reactRecommendedRules =
  (react.configs &&
    react.configs.recommended &&
    react.configs.recommended.rules) ||
  {}

module.exports = [
  // Ignore build artifacts
  {
    ignores: [
      'build/**',
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'eslint.config.js',
      'scripts/**',
    ],
  },

  // Base JS recommended rules
  js.configs.recommended,

  // TypeScript (TS/TSX)
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 'latest',
        sourceType: 'module',
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: 'readonly',
        document: 'readonly',
        fetch: 'readonly',
        Headers: 'readonly',
        Request: 'readonly',
        Response: 'readonly',
        JSX: 'readonly',
        HTMLInputElement: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
    },
    rules: {
      // Disable conflicting core rules and enable TS recommended
      ...tsEslintCompatRules,
      ...tsRecommendedRules,
      'no-undef': 'off',
    },
  },

  // React (TSX/JSX)
  {
    files: ['**/*.tsx', '**/*.jsx'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: {
      react: { version: 'detect' },
    },
    plugins: {
      react,
    },
    rules: {
      ...reactRecommendedRules,
      'react/no-deprecated': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-uses-react': 'off',
    },
  },
]
