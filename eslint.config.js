const js = require('@eslint/js');
const prettier = require('eslint-config-prettier/flat');
const { defineConfig, globalIgnores } = require('eslint/config');
const globals = require('globals');

module.exports = defineConfig([
  globalIgnores(['node_modules/', 'coverage/', 'uploads/', 'public/css/**', '**/*.min.js']),
  js.configs.recommended,
  {
    rules: {
      'no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^(_|next$)',
          caughtErrorsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['**/*.js', 'bin/www'],
    ignores: ['public/js/**'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
  {
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'script', globals: { ...globals.browser } },
  },
  prettier,
]);
