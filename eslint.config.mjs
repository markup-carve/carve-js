import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

export default [{
  files: ['src/html-import-dom.ts', 'src/own-property.ts', 'src/source-positions.ts'],
  languageOptions: {
    parser: tseslint.parser,
    parserOptions: {
      project: './tsconfig.boundaries.json',
      // CLI single-run mode reads disk instead of supplied stdin/editor text.
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
  },
}]
