import { fileURLToPath } from 'node:url'
import sonarjs from 'eslint-plugin-sonarjs'
import tseslint from 'typescript-eslint'

const typedRules = {
  '@typescript-eslint/no-unsafe-assignment': 'error',
  '@typescript-eslint/no-unsafe-argument': 'error',
  '@typescript-eslint/no-unsafe-call': 'error',
  '@typescript-eslint/no-unsafe-member-access': 'error',
  '@typescript-eslint/no-unsafe-return': 'error',
  '@typescript-eslint/no-floating-promises': 'error',
  '@typescript-eslint/no-misused-promises': 'error',
  '@typescript-eslint/switch-exhaustiveness-check': 'error',
}

export default [{
  // The engine: typed rules against its own project, and a complexity cap of 15.
  files: ['src/**/*.ts', 'public/**/*.ts', 'cli/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts', 'lint/**/*.ts', 'migrate/**/*.ts', 'proptest/**/*.ts', 'extensions/**/*.ts', 'import/**/*.ts', 'upgrade/**/*.ts'],
  ignores: ['upgrade/engine-0.1/**'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: ['./tsconfig.json', './import/tsconfig.json', './proptest/tsconfig.json', './upgrade/tsconfig.json'],
      disallowAutomaticSingleRunInference: true,
      tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  plugins: { '@typescript-eslint': tseslint.plugin, sonarjs },
  rules: {
    ...typedRules,
    complexity: ['error', { max: 15 }],
    'sonarjs/cognitive-complexity': ['error', 15],
  },
}, {
  // width-data.ts holds the Unicode tables of the 0.1 engine, copied unchanged from its generator.
  files: ['src/**/*.ts', 'public/**/*.ts', 'cli/**/*.ts', 'test/**/*.ts', 'scripts/**/*.ts', 'lint/**/*.ts', 'migrate/**/*.ts', 'proptest/**/*.ts', 'extensions/**/*.ts', 'import/**/*.ts', 'upgrade/**/*.ts'],
  ignores: ['upgrade/engine-0.1/**', 'test/*.test.ts', 'src/width-data.ts'],
  rules: { 'max-len': ['error', { code: 140, ignoreUrls: true }] },
}, {
  // A test states its input and its expected output as one literal each.
  files: ['public/**/*.ts', 'cli/**/*.ts', 'test/**/*.ts', 'lint/**/*.ts', 'migrate/**/*.ts', 'proptest/**/*.ts', 'extensions/**/*.ts'],
  ignores: ['test/support/**'],
  rules: { 'max-len': ['error', { code: 140, ignoreUrls: true, ignoreStrings: true, ignoreTemplateLiterals: true }] },
}, {
  // Generated from data/lint-model.json: one function per rule, its conditions inlined.
  files: ['lint/data-tables.ts'],
  rules: { complexity: 'off', 'sonarjs/cognitive-complexity': 'off', 'max-len': 'off' },
}]
