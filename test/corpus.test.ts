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
  '13-attributes',
  '14-frontmatter',
  '15-heading-ids',
  '16-reference-link',
  '17-collapsed-reference-link',
  '18-unresolved-reference-link',
  '19-smart-typography-dashes-and-quotes',
  '20-smart-typography-arrows-and-symbols',
  '21-math',
  '22-footnotes',
  '23-inline-footnotes',
  '24-generic-divs',
  '25-definition-lists',
  '26-comments',
  '27-raw-blocks',
  '28-hard-line-breaks',
  '29-non-breaking-space',
  '30-raw-inline',
  '31-ordered-list-start-and-delimiter',
  '32-ordered-list-dialects',
  '33-editorial-markup',
  '34-thematic-breaks',
  '35-cross-reference',
  '36-autolinks',
  '37-escapes',
  '38-bare-urls-stay-literal',
  '39-inline-span',
  '40-superscript-and-subscript',
  '41-line-blocks',
  '42-admonitions',
  '43-abbreviations',
  '44-mentions-and-tags',
  '45-inline-extensions',
  '46-symbols',
  '47-numbered-cross-references',
  '48-table-column-alignment',
  '49-table-per-cell-alignment-override',
  '50-headerless-table-alignment',
  '51-table-without-alignment',
  '52-table-alignment-with-colspan',
  '53-table-doubled-alignment-marker',
  '54-fenced-code-shorter-inner-fence',
  '55-blockquote-caption-after-a-blank-line',
  '56-table-cell-escaped-pipe',
  '57-table-cell-pipe-inside-code-span',
  '58-abbreviation-matches-on-word-boundaries-only',
  '59-mention-ignores-email-addresses',
  '60-tag-requires-a-word-boundary',
  '61-table-stacked-rowspan',
  '62-smart-typography-escapes-and-code',
  '63-table-multi-line-cell-continuation',
  '64-table-rowspan-with-multi-line-content',
  '65-ordered-marker-vs-prose',
  '66-footnote-with-multiple-blocks',
  '67-empty-delimiters',
  '68-nested-containers',
  '69-attribute-edge-cases',
  '70-escape-coverage',
  '71-parenthesized-ordered-marker',
  '72-emphasis-edge-cases',
  '73-list-nesting-and-looseness',
  '74-doubled-emphasis-delimiters',
  '75-nested-brackets-in-link-text',
  '76-reference-labels-are-case-sensitive',
  '77-two-char-delimiter-runs',
  '78-trailing-attribute-block-edge-cases',
  '79-paragraph-interruption',
  '80-blockquote-lazy-continuation',
  '81-fenced-code-language-with-punctuation',
  '82-multi-line-headings',
  '83-blockquote-lazy-continuation-stops-at-a-fenced-block',
  '84-list-lazy-continuation',
  '85-compact-list-blocks',
  '86-list-continuation-marker',
  '87-block-attribute-lines',
  '88-list-item-attributes',
  '89-mention-and-tag-name-boundaries',
  '90-superscript-in-a-table-cell',
  '91-nested-comment-fences',
  '92-strong-emphasis-starting-with-a-link',
  '93-abbreviation-definition-interrupts-a-paragraph',
  '94-literal-less-than-in-prose',
  '95-boolean-attributes',
  '96-table-span-marker-in-first-column',
  '97-table-cell-attributes',
  '98-table-row-attributes',
  '99-table-header-cell-rowspan',
  '100-block-quote-continuation-marker',
  '101-heading-marker-column-zero',
  '102-paragraph-trailing-whitespace',
  '103-marker-line-nested-lists',
  '104-blocked-span-marker-renders-as-empty-cell',
  '105-colspan-marker-scans-left-past-a-consumed-cell',
  '106-security-hardening',
  '107-link-destination-stops-at-the-first-parenthesis',
  '108-empty-link-and-image-titles-are-preserved',
  '109-cross-references-resolve-inside-footnote-bodies',
  '110-unquoted-attribute-values-may-contain-dots-and-colons',
  '111-a-pipe-pair-with-no-cell-is-not-a-table',
  '112-adjacent-attribute-blocks-on-one-line-merge',
  '113-a-continuation-row-needs-a-body-row',
  '114-fence-opener-with-a-nested-list-body-inside-a-list-item',
  '115-footnote-definition-inside-a-container-is-collected',
  '116-cyclic-cross-reference-resolves-to-one-level',
  '117-trojan-source-heading-ids-are-nfc-normalized-and-strip-invisible-controls',
  '118-trojan-source-rendered-text-and-code-strip-bidi-override-controls',
  '119-scheme-probe-strips-unicode-whitespace',
  '120-footnotes-placement',
  '121-classes-are-deduplicated',
  '122-code-span-and-image-trailing-attributes-are-strict',
  '123-a-bare-attribute-block-on-its-own-line-is-literal',
  '124-a-backslash-in-a-link-destination-is-a-literal-character',
  '125-autolink-display-keeps-the-raw-content',
  '126-editorial-markup-takes-a-trailing-attribute',
  '127-emphasis-opener-slash-adjacency',
  '128-bold-italic-delimiter-needs-content',
  '129-emphasis-span-closes-before-a-following-delimiter',
  '130-thematic-break-requires-contiguous-markers',
  '131-sublist-marker-interrupts-a-continuation-paragraph',
  '132-footnote-definition-requires-an-inline-body',
  '133-footnote-definition-separator-must-be-a-space',
  '134-link-reference-definition-separator-must-be-a-space',
  '135-abbreviation-definition-separator-must-be-a-space',
  '136-unclaimed-openers-stay-literal',
  '137-inline-literal',
  '138-all-space-verbatim-content',
  '139-trailing-whitespace-boundaries',
  '140-table-row-closing-pipe',
  '141-post-blank-list-continuation-content-column-model',
])

const baseSlug = (name: string) => name.replace(/-\d+$/, '')

const pairs = readdirSync(corpusDir)
  .filter((f) => f.endsWith('.crv'))
  .map((f) => basename(f, '.crv'))
  .sort()

// Coverage guard: every distinct `NN-slug` base category present in the spec
// corpus MUST be listed in IMPLEMENTED. Categories not in IMPLEMENTED are run
// as `.todo` above and silently skipped, which is exactly how 14 spec
// categories once went unvalidated. This is a REAL test (not todo): when a
// future spec adds a corpus category, this fails with the missing names,
// forcing the category into IMPLEMENTED (or the build breaks).
describe('spec corpus coverage guard', () => {
  it('every corpus base category is in IMPLEMENTED', () => {
    const categories = new Set<string>()
    for (const name of pairs) {
      if (!existsSync(resolve(corpusDir, `${name}.html`))) continue
      categories.add(baseSlug(name))
    }
    const missing = [...categories]
      .filter((c) => !IMPLEMENTED.has(c))
      .sort()
    expect(
      missing,
      `Corpus categories missing from IMPLEMENTED (add them so they are not silently .todo): ${missing.join(', ')}`,
    ).toEqual([])
  })
})

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

    if (allowlisted) {
      it(`${name}`, () => {
        const actual = carveToHtml(source)
        expect(actual.trim()).toBe(expected.trim())
      })
    } else {
      it.todo(`${name}`)
    }
  }
})
