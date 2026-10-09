import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

export default [{
  files: ['src/markdown-assessment.ts', 'src/append-only-closer.ts', 'src/backtick-run-index.ts', 'src/substitution-scanner.ts', 'src/attachment-fence-closers.ts', 'src/scoped-fence-closers.ts', 'src/verse-whitespace.ts', 'src/reference-resolution.ts', 'src/html-import-report.ts', 'src/source-positions.ts', 'src/own-property.ts', 'src/html-import-dom.ts', 'src/attribute-merge.ts', 'src/inline-resolution.ts', 'src/inline-children.ts', 'src/unresolved-reference.ts', 'src/block-children.ts', 'src/attribute-parser.ts', 'src/html-import-code-language.ts', 'src/label-key.ts', 'src/link-destination.ts', 'src/source-layout.ts', 'src/tab-normalize.ts', 'src/paragraph-indent.ts', 'src/thematic-break-marker.ts', 'src/colon-fences.ts', 'src/math-block.ts', 'src/smart-quotes.ts', 'src/trim-non-nbsp.ts', 'src/sentinel-run.ts', 'src/table-spans.ts', 'src/table-source-metadata.ts', 'src/import-report-messages.ts', 'src/conversion-diagnostics.ts', 'src/deny-listed-destination.ts', 'src/reference-state.ts', 'src/verbatim-payload.ts', 'src/source-patch.ts', 'src/coalesce-text-runs.ts', 'src/owned-child-fields.ts', 'src/carve-escape.ts', 'src/case-migrate.ts', 'src/ast-structural-index.ts'],
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
