import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

// The rules of the engine: typed checks and a complexity cap of 15. The frozen 0.1 reader is not linted.
export default [{
  files: ['**/*.ts'],
  ignores: ['engine-0.1/**'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: './tsconfig.json',
      disallowAutomaticSingleRunInference: true,
      tsconfigRootDir: fileURLToPath(new URL('.', import.meta.url)),
    },
  },
  plugins: { '@typescript-eslint': tseslint.plugin },
  rules: {
    '@typescript-eslint/no-unsafe-assignment': 'error',
    '@typescript-eslint/no-unsafe-argument': 'error',
    '@typescript-eslint/no-unsafe-call': 'error',
    '@typescript-eslint/no-unsafe-member-access': 'error',
    '@typescript-eslint/no-unsafe-return': 'error',
    '@typescript-eslint/no-floating-promises': 'error',
    '@typescript-eslint/no-misused-promises': 'error',
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
    complexity: ['error', { max: 15 }],
  },
}]
