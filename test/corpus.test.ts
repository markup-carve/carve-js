/*
 * Spec-corpus test runner.
 *
 * Walks spec/tests/corpus/, pairs every NN-slug.crv with its
 * NN-slug.html, feeds the .crv through parse + renderHtml, and asserts
 * byte-identical match against the .html (after trimming).
 *
 * Pairs in IMPLEMENTED are run as real tests; everything else is marked
 * .todo. As each construct lands, add its slug here and the test goes
 * from todo → passing.
 */

import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve, basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { carveToHtml } from '../src/index.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const corpusDir = resolve(__dirname, '../spec/tests/corpus')

if (!existsSync(corpusDir)) {
  throw new Error(
    `Spec corpus not found at ${corpusDir}.\n` +
      `Did you initialize the submodule?\n` +
      `  git submodule update --init`,
  )
}

/**
 * Category prefixes the parser + renderer can handle. Every sub-example
 * with a matching prefix runs as a real test (e.g. '01-emphasis' covers
 * '01-emphasis-2', '01-emphasis-3', …). Grows with each PR.
 */
const IMPLEMENTED = new Set([
  '01-emphasis',
  '02-headings',
  '03-links',
  '04-images',
  '05-lists',
  '06-task-lists',
  '07-blockquote-with-attribution',
  '08-image-with-caption',
  '09-tables',
  '10-tables-with-rowspan-and-colspan',
  '11-fenced-code',
  '12-inline-code',
  '13-admonitions',
  '14-abbreviations',
  '15-mentions-and-tags',
  '16-inline-extensions',
  '17-attributes',
  '18-frontmatter',
  '19-heading-ids',
  '20-table-column-alignment',
  '21-table-per-cell-alignment-override',
  '22-headerless-table-alignment',
  '23-table-without-alignment',
  '24-table-alignment-with-colspan',
  '25-table-doubled-alignment-marker',
  '26-fenced-code-shorter-inner-fence',
  '27-blockquote-caption-after-a-blank-line',
  '28-table-cell-escaped-pipe',
  '29-table-cell-pipe-inside-code-span',
  '30-abbreviation-matches-on-word-boundaries-only',
  '31-mention-ignores-email-addresses',
  '32-tag-requires-a-word-boundary',
  '33-table-stacked-rowspan',
  '34-reference-link',
  '35-collapsed-reference-link',
  '36-unresolved-reference-link',
  '37-smart-typography-dashes-and-quotes',
  '38-smart-typography-arrows-and-symbols',
  '39-smart-typography-escapes-and-code',
  '40-table-multi-line-cell-continuation',
  '41-table-rowspan-with-multi-line-content',
  '42-math',
  '43-footnotes',
  '44-generic-divs',
  '45-definition-lists',
  '46-comments',
  '47-raw-blocks',
  '48-hard-line-breaks',
  '49-non-breaking-space',
  '50-raw-inline',
  '51-emoji',
  '52-ordered-list-start-and-delimiter',
  '53-ordered-list-dialects',
  '54-ordered-marker-vs-prose',
  '55-footnote-with-multiple-blocks',
  '56-editorial-markup',
  '57-thematic-breaks',
  '58-cross-reference',
  '59-autolinks',
  '60-escapes',
  '61-empty-delimiters',
  '62-bare-urls-stay-literal',
  '63-nested-containers',
  '64-attribute-edge-cases',
  '65-escape-coverage',
  '66-inline-span',
  '67-superscript-and-subscript',
  '68-parenthesized-ordered-marker',
  '69-emphasis-edge-cases',
  '70-list-nesting-and-looseness',
  '71-doubled-emphasis-delimiters',
  '72-nested-brackets-in-link-text',
  '73-reference-labels-are-case-sensitive',
  '74-two-char-delimiter-runs',
  '75-trailing-attribute-block-edge-cases',
  '88-line-blocks',
])

/**
 * Sub-examples in IMPLEMENTED categories that are known to fail because
 * a specific construct is not yet supported. Move out of this set as
 * implementation lands.
 */
const KNOWN_GAPS = new Set<string>([
  // Inline-attribute `:::` openers. The carve#119 spec corpus expects
  // `::: {.x}` / `:::{k=v}` to open an attributed div, but carve-js follows
  // strict djot (merged PR #149): a `:::` fence carries NO inline attributes,
  // so these openers are paragraphs here. This is an orthogonal policy
  // difference, independent of the line-block `|` opener this branch adds.
  '44-generic-divs',
  '64-attribute-edge-cases-7',
  '88-line-blocks-5',
])

const baseSlug = (name: string) => name.replace(/-\d+$/, '')

const pairs = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.crv'))
  .map((f) => basename(f, '.crv'))
  .sort()

describe('spec corpus', () => {
  for (const name of pairs) {
    const crvPath = resolve(corpusDir, `${name}.crv`)
    const htmlPath = resolve(corpusDir, `${name}.html`)

    if (!existsSync(htmlPath)) {
      it.skip(`${name} (missing .html pair)`, () => {})
      continue
    }

    const source = readFileSync(crvPath, 'utf8')
    const expected = readFileSync(htmlPath, 'utf8')
    const allowlisted = IMPLEMENTED.has(name) || IMPLEMENTED.has(baseSlug(name))

    if (allowlisted && !KNOWN_GAPS.has(name)) {
      it(`${name}`, () => {
        const actual = carveToHtml(source)
        expect(actual.trim()).toBe(expected.trim())
      })
    } else {
      it.todo(`${name}`)
    }
  }
})
