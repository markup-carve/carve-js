import { fileURLToPath } from 'node:url'
import tseslint from 'typescript-eslint'

export default [{
  files: ['src/import/markdown/markdown-assessment.ts', 'src/import/markdown/markdown-email-links.ts', 'src/import/markdown/markdown-gfm-autolinks.ts', 'src/parse/block/append-only-closer.ts', 'src/parse/inline/backtick-run-index.ts', 'src/parse/inline/substitution-scanner.ts', 'src/parse/block/attachment-fence-closers.ts', 'src/parse/block/scoped-fence-closers.ts', 'src/parse/block/literal-comment-closers.ts', 'src/parse/block/verse-whitespace.ts', 'src/parse/inline/reference-resolution.ts', 'src/import/html/html-import-footnote-stage.ts', 'src/import/html/html-import-table-stage.ts', 'src/import/html/html-import-table-row-groups.ts', 'src/import/html/html-import-report.ts', 'src/source/source-positions.ts', 'src/own-property.ts', 'src/import/html/html-import-dom.ts', 'src/extension/attribute-merge.ts', 'src/parse/inline/inline-resolution.ts', 'src/parse/inline/inline-children.ts', 'src/parse/inline/unresolved-reference.ts', 'src/parse/block/block-children.ts', 'src/extension/attribute-parser.ts', 'src/import/html/html-import-code-language.ts', 'src/label-key.ts', 'src/link-destination.ts', 'src/source-layout.ts', 'src/tab-normalize.ts', 'src/parse/block/paragraph-indent.ts', 'src/parse/block/thematic-break-marker.ts', 'src/parse/block/colon-fences.ts', 'src/extension/math-block.ts', 'src/extension/smart-quotes.ts', 'src/trim-non-nbsp.ts', 'src/parse/inline/sentinel-run.ts', 'src/table/table-spans.ts', 'src/table/table-source-metadata.ts', 'src/import/markdown/import-report-messages.ts', 'src/import/markdown/conversion-diagnostics.ts', 'src/import/markdown/deny-listed-destination.ts', 'src/parse/inline/reference-state.ts', 'src/verbatim-payload.ts', 'src/source-patch.ts', 'src/coalesce-text-runs.ts', 'src/ast/owned-child-fields.ts', 'src/carve-escape.ts', 'src/import/markdown/case-migrate.ts', 'src/ast/structural-index.ts', 'src/import/markdown/carrier-markers.ts', 'src/import/djot/djot-image-child-text.ts', 'src/ast/roundtrip-carriers.ts'],
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
}, {
  files: ['src/**/*.ts'],
  languageOptions: { parser: tseslint.parser },
  rules: { complexity: ['error', { max: 99 }] },
}]
