module.exports = {
  root: true,
  env: {
    es2024: true,
    node: true,
    browser: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: ['./tsconfig.json', './tsconfig.scripts.json'],
    tsconfigRootDir: __dirname,
  },
  plugins: ['@typescript-eslint', 'react'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'prettier',
  ],
  settings: {
    react: {
      version: '18.3',
    },
  },
  rules: {
    '@typescript-eslint/no-explicit-any': 'error',
    '@typescript-eslint/explicit-function-return-type': ['error', { allowExpressions: true }],
    'react/react-in-jsx-scope': 'off',
  },
  ignorePatterns: ['node_modules', '.turbo', 'dist', '.next', 'coverage'],
  overrides: [
    {
      files: ['**/*.ts', '**/*.tsx'],
      rules: {
        '@typescript-eslint/no-floating-promises': 'error',
      },
    },
    {
      files: [
        'apps/api/**/*.ts',
        'packages/db/**/*.ts',
        'packages/shared/**/*.ts',
        'packages/ai/**/*.ts',
        'workers/**/*.ts',
      ],
      env: {
        node: true,
      },
      parserOptions: {
        project: ['./tsconfig.json'],
      },
    },
    {
      files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
      env: {
        browser: true,
      },
      settings: {
        react: {
          version: '18.3',
        },
      },
    },
  ],
};
