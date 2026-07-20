// Minimal, deliberately light lint config — catches real bugs (unused vars,
// undefined globals) without imposing a strict style regime.
const js = require('@eslint/js');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: {
        require: 'readonly',
        module: 'readonly',
        exports: 'writable',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        setInterval: 'readonly',
        // Node 18+ globals (this project requires Node >=18 — see package.json "engines")
        fetch: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      // Stylistic, not a bug — several existing regexes escape `-` inside a
      // character class for readability even where not strictly required.
      'no-useless-escape': 'warn',
    },
  },
  {
    languageOptions: {
      globals: {
        describe: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
    files: ['test/**/*.js'],
  },
  {
    ignores: ['node_modules/**', 'test/*.db*', 'prisma/migrations/**'],
  },
];
