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
  'a-flush-left-line-needs-an-open-paragraph-to-fold-into',
  'a-list-item-does-not-define-an-abbreviation-either',
  'an-abbreviation-definition-is-recognized-only-at-document-level',
  'opaque-spans-inside-a-container',
  'blocks-that-render-to-nothing',
  'bare-dot-ordered-markers',
  'emphasis',
  'headings',
  'links',
  'images',
  'lists',
  'task-lists',
  'blockquote-with-attribution',
  'image-with-caption',
  'tables',
  'tables-with-rowspan-and-colspan',
  'fenced-code',
  'inline-code',
  'attributes',
  'frontmatter',
  'heading-ids',
  'reference-link',
  'collapsed-reference-link',
  'unresolved-reference-link',
  'smart-typography-dashes-and-quotes',
  'smart-typography-arrows-and-symbols',
  'math',
  'footnotes',
  'inline-footnotes',
  'generic-divs',
  'definition-lists',
  'comments',
  'raw-blocks',
  'hard-line-breaks',
  'non-breaking-space',
  'raw-inline',
  'ordered-list-start-and-delimiter',
  'ordered-list-dialects',
  'editorial-markup',
  'thematic-breaks',
  'cross-reference',
  'autolinks',
  'escapes',
  'bare-urls-stay-literal',
  'inline-span',
  'superscript-and-subscript',
  'line-blocks',
  'admonitions',
  'abbreviations',
  'mentions-and-tags',
  'inline-extensions',
  'symbols',
  'numbered-cross-references',
  'table-column-alignment',
  'table-per-cell-alignment-override',
  'headerless-table-alignment',
  'table-without-alignment',
  'table-alignment-with-colspan',
  'table-doubled-alignment-marker',
  'fenced-code-shorter-inner-fence',
  'blockquote-caption-after-a-blank-line',
  'table-cell-escaped-pipe',
  'table-cell-pipe-inside-code-span',
  'abbreviation-matches-on-word-boundaries-only',
  'mention-ignores-email-addresses',
  'tag-requires-a-word-boundary',
  'table-stacked-rowspan',
  'smart-typography-escapes-and-code',
  'table-multi-line-cell-continuation',
  'table-rowspan-with-multi-line-content',
  'ordered-marker-vs-prose',
  'footnote-with-multiple-blocks',
  'empty-delimiters',
  'nested-containers',
  'attribute-edge-cases',
  'escape-coverage',
  'parenthesized-ordered-marker',
  'emphasis-edge-cases',
  'list-nesting-and-looseness',
  'doubled-emphasis-delimiters',
  'nested-brackets-in-link-text',
  'reference-labels-are-case-sensitive',
  'two-char-delimiter-runs',
  'trailing-attribute-block-edge-cases',
  'paragraph-interruption',
  'blockquote-lazy-continuation',
  'fenced-code-language-with-punctuation',
  'single-line-headings',
  'blockquote-lazy-continuation-stops-at-a-fenced-block',
  'list-lazy-continuation',
  'compact-list-blocks',
  'list-continuation-marker',
  'block-attribute-lines',
  'list-item-attributes',
  'mention-and-tag-name-boundaries',
  'superscript-in-a-table-cell',
  'nested-comment-fences',
  'strong-emphasis-starting-with-a-link',
  'abbreviation-definition-interrupts-a-paragraph',
  'literal-less-than-in-prose',
  'boolean-attributes',
  'table-span-marker-in-first-column',
  'table-cell-attributes',
  'table-row-attributes',
  'table-header-cell-rowspan',
  'block-quote-continuation-marker',
  'heading-marker-column-zero',
  'paragraph-trailing-whitespace',
  'marker-line-nested-lists',
  'blocked-span-marker-renders-as-empty-cell',
  'colspan-marker-scans-left-past-a-consumed-cell',
  'security-hardening',
  'link-destination-parentheses-balance',
  'empty-link-and-image-titles-are-preserved',
  'cross-references-resolve-inside-footnote-bodies',
  'unquoted-attribute-values-may-contain-dots-and-colons',
  'a-pipe-pair-with-no-cell-is-not-a-table',
  'adjacent-attribute-blocks-on-one-line-merge',
  'a-continuation-row-needs-a-body-row',
  'fence-opener-with-a-nested-list-body-inside-a-list-item',
  'footnote-definition-inside-a-container-is-collected',
  'cyclic-cross-reference-resolves-to-one-level',
  'trojan-source-heading-ids-are-nfc-normalized-and-strip-invisible-controls',
  'trojan-source-rendered-text-and-code-strip-bidi-override-controls',
  'scheme-probe-strips-unicode-whitespace',
  'footnotes-placement',
  'classes-are-deduplicated',
  'code-span-and-image-trailing-attributes-are-strict',
  'a-bare-attribute-block-on-its-own-line-is-literal',
  'a-backslash-in-a-link-destination-is-a-literal-character',
  'autolink-display-keeps-the-raw-content',
  'editorial-markup-takes-a-trailing-attribute',
  'emphasis-opener-slash-adjacency',
  'bold-italic-delimiter-needs-content',
  'emphasis-span-closes-before-a-following-delimiter',
  'thematic-break-requires-contiguous-markers',
  'sublist-marker-interrupts-a-continuation-paragraph',
  'footnote-definition-requires-an-inline-body',
  'footnote-definition-separator-must-be-a-space',
  'link-reference-definition-separator-must-be-a-space',
  'abbreviation-definition-separator-must-be-a-space',
  'unclaimed-openers-stay-literal',
  'inline-literal',
  'all-space-verbatim-content',
  'trailing-whitespace-boundaries',
  'table-row-closing-pipe',
  'post-blank-list-continuation-content-column-model',
  'nested-item-looseness-does-not-propagate-to-the-outer-item',
  'definition-list-as-a-first-class-block-opener',
  'table-as-a-block-opener-in-a-list-item',
  'adjacent-slash-and-underscore-emphasis-nest',
  'colon-fence-as-a-block-opener-in-a-list-item',
  'fence-folds-as-lazy-inline-code-above-the-content-column',
  'abbreviation-title-escapes-its-markup-characters',
  'indented-ordered-marker-content-column-includes-the-marker-indent',
  'leading-attribute-brace-before-an-inline-span-stays-literal',
  'attribute-block-after-a-mention-stays-literal',
  'under-indented-definition-attaches-over-indented-definition-folds',
  'image-trailing-attribute-is-strict-about-the-glue',
  'wrapped-definition-term-continuation-below-the-content-column-strips-leading-whitespace',
  'indented-attribute-line-stays-literal',
  'indented-image-and-caption-stay-literal',
  'indented-reference-and-footnote-definitions-stay-literal',
  'indented-colon-fence-blocks-stay-literal',
  'below-content-column-div-body-in-a-list-item-stays-literal',
  'outer-item-with-an-internal-blank-before-an-attached-block-is-loose',
  'unresolved-footnote-reference-with-a-trailing-attribute-stays-literal',
  'tight-list-item-keeps-trailing-text-after-a-block-bare',
  'quote-flanking-after-an-escaped-character',
  'comment-fence-with-trailing-text',
  'unterminated-comment-fence',
  'widened-verbatim-fences',
  'only-the-id-hoists-to-the-section-wrapper',
  'headings-inside-containers-are-not-wrapped',
  'attribute-order-on-an-unwrapped-heading',
  'attribute-braces-on-a-list-item-marker-line',
  'implicit-heading-references-with-no-definition',
  'a-repeated-definition-which-one-wins',
  'a-marker-separator-is-a-space-never-a-tab',
  'two-abbreviation-definitions',
  'openers-past-the-nesting-cap-are-one-paragraph',
  'a-comment-is-recognized-at-any-column',
  'a-definition-below-every-content-column-folds-as-text',
  'a-caret-is-a-reference-label-not-an-empty-footnote',
  'an-invisible-line-does-not-cancel-a-blank-line-separation',
  'a-comment-fence-is-a-comment-at-any-column-too',
  'a-floating-attribute-stops-at-the-item-boundary',
  'a-comment-under-a-nested-item-does-not-close-it',
  'a-definition-inside-a-comment-registers-nothing',
  'a-blank-after-a-comment-still-ends-the-item',
  'a-comment-fence-under-a-nested-item-does-not-close-it-either',
  'a-collapsed-reference-is-matched-by-the-label-the-author-wrote',
  'an-abbreviation-at-a-list-item-s-content-column-is-still-not-a-definition',
])

// A corpus file is `NN-slug` or `NN-slug-VARIANT`. The CATEGORY is the slug
// alone: the leading number is the spec's ordering, not an identity, and it
// shifts whenever a section is inserted upstream. Keying the allowlist by it
// meant every renumbering broke this guard for ~100 categories that had not
// changed at all - which is how the bump PRs came to say "needs human work"
// for what was really a rename.
const baseSlug = (name: string) => name.replace(/-\d+$/, '').replace(/^\d+-/, '')

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
    const allowlisted = IMPLEMENTED.has(name.replace(/^\d+-/, '')) || IMPLEMENTED.has(baseSlug(name))

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
