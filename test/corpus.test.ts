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
  '51-symbols',
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
  '89-mention-and-tag-name-boundaries',
  '90-superscript-in-a-table-cell',
  '91-nested-comment-fences',
  '92-strong-emphasis-starting-with-a-link',
  '93-abbreviation-definition-interrupts-a-paragraph',
  '94-literal-less-than-in-prose',
  '95-boolean-attributes',
  '96-table-span-marker-in-first-column',
  '98-table-row-attributes',
  '99-table-header-cell-rowspan',
  '76-paragraph-interruption',
  '77-blockquote-lazy-continuation',
  '78-fenced-code-language-with-punctuation',
  '79-multi-line-headings',
  '80-blockquote-lazy-continuation-stops-at-a-fenced-block',
  '81-list-lazy-continuation',
  '82-compact-list-blocks',
  '83-list-continuation-marker',
  '84-block-attribute-lines',
  '85-numbered-cross-references',
  '86-inline-footnotes',
  '87-list-item-attributes',
  '97-table-cell-attributes',
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
