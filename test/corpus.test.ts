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
import { expectedCorpusSize } from './helpers/corpus-population.js'

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
  'a-raw-block-keeps-the-blank-line-at-the-end-of-its-payload-too',
  'an-unterminated-fence-at-a-content-column-opens-no-block-so-the-paragraph-stays-open',
  'table-columns-carry-alignment-vertical-alignment-and-widths',
  'a-table-alignment-run-carries-two-independent-axes',
  'a-vertical-table-marker-needs-a-horizontal-partner',
  'a-table-cell-can-inherit-horizontal-alignment',
  'an-all-blank-raw-payload-still-emits-its-line',
  'a-quote-is-reached-by-its-marker-and-a-column-never-reaches-into-one',
  // The category the freeze at carve `0f6b990` adds. It needed no engine work:
  // this build renders all four of its documents, and all 62 quote/list prefixes
  // to depth five for both definition kinds, exactly as the executable spec does
  // (markup-carve/carve#1368).
  'a-definition-behind-an-alternating-container-prefix-registers-at-the-innermost-content-column',
  // The twelve categories the freeze at carve `0490ae5` brings in. Four pin the
  // line-block hard-break ruling `#1188` implemented; the other eight are the
  // container-boundary family - a block at a container's content column ends
  // the paragraph it sits under, however the block is spelled and whatever it
  // renders - plus the two controls that catch an over-wide reading of it.
  'a-bracketed-construct-spanning-a-line-boundary',
  'a-bracketed-construct-spanning-a-verse-boundary',
  'a-bracketed-construct-s-identifiers-stay-on-one-line',
  'a-closed-inline-construct-spanning-a-verse-boundary',
  'a-block-at-a-container-s-content-column-ends-the-paragraph-whatever-it-renders',
  'a-container-whose-table-ends-on-a-continuation-row',
  'a-container-whose-table-ends-on-a-joined-header-row',
  'a-continuation-row-joins-the-row-above-it-whatever-its-cells-hold',
  'a-definition-at-a-container-s-content-column',
  'a-footnote-definition-s-block-runs-to-the-end-of-its-body',
  'a-quote-inside-a-quote-is-asked-what-it-ends-on',
  'what-a-content-column-block-does-not-reach',
  // Four categories the pin bump for PART 11 §10e brings into the corpus. The
  // engine work for each of them already landed here (`#1029`, `#1030`,
  // `#1038`, `#1041`); only the pin was behind, so these are bookkeeping and
  // not new behavior - each runs as a real test from here on.
  'a-marker-glued-to-a-name-opens-nothing',
  'a-math-span-s-base-class-keeps-the-class-slot-in-place',
  'an-abbreviation-expands-inside-an-inline-container',
  'an-angle-bracket-is-escaped-only-where-it-opens-markup',
  'a-semantic-name-renames-the-span-and-the-leftovers-ride-the-element',
  'a-derived-title-yields-to-an-authored-one',
  'two-attributes-need-a-separator-between-them',
  'the-semantic-registry-holds-no-element-carve-already-spells',
  'a-boolean-lang-is-the-third-spelling-of-the-same-key',
  'a-language-attribute-is-exact-sugar-for-lang',
  'a-malformed-language-tag-leaves-the-whole-block-literal',
  'a-language-attribute-and-lang-are-one-key',
  'the-language-sigil-takes-no-padding',
  'a-semantic-span-keeps-its-wrapper-unless-consumption-empties-it',
  'a-structural-attribute-leads-the-author-s-own',
  'a-caret-line-does-not-end-a-paragraph-it-cannot-caption',
  'heading-index-plain-text-covers-visible-leaves-and-rejects-an-empty-key',
  'a-column-zero-definition-ends-an-open-list-item',
  'adjacent-block-openers-in-an-attached-run-stay-separate',
  'adjacent-sibling-lists-survive-the-round-trip',
  'an-empty-footnote-body-is-written-with-the-empty-sentinel',
  'a-caption-attaches-across-one-blank-line',
  'a-container-a-lazy-line-folded-into-is-still-open',
  'a-ragged-table-keeps-each-row-s-cell-count',
  'two-blank-lines-detach-a-caption',
  // Added with the spec bump that carries carve#802, #808 and #831: ten rules
  // the corpus stated and nothing pinned until then, plus the format-character
  // boundary. This engine passes all of them as they land - they are documents
  // about rules it already implements, which is why they arrive here rather
  // than in a skip list.
  'an-empty-abbreviation-term-is-not-a-definition',
  'an-at-sign-is-a-reference-label-character-everywhere-but-the-first-position',
  'a-tab-after-a-heading-quote-or-caption-marker-leaves-the-line-as-prose',
  'two-dashes-are-not-a-thematic-break',
  'two-backticks-are-not-a-code-fence-opening-or-closing',
  'a-single-percent-is-not-a-comment',
  'an-uppercase-roman-numeral-is-a-list-marker',
  'a-table-delimiter-cell-needs-at-least-one-dash',
  'a-continuation-row-carries-no-trailing-text',
  'a-format-character-before-a-scheme-is-not-stripped-and-is-inert',
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
  'composite-figures',
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
  'line-endings-and-a-byte-order-mark',
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
  'a-boolean-and-a-key-value-of-the-same-name-are-one-attribute',
  'two-attributes-need-a-separator-between-them',
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
  'a-link-definition-written-before-a-footnote-stays-before-it',
  'a-zero-width-character-in-a-reference-definition-destination',
  'a-block-image-is-separated-from-the-block-after-it-on-every-target',
  'a-tab-indent-is-the-column-it-reaches-whatever-the-line-holds',
  'a-tab-separates-two-attributes-and-pads-a-block-as-a-space-does',
  'the-same-column-written-with-four-spaces',
  'sibling-markers-that-reach-one-column-are-one-list',
  'heading-index-plain-text-covers-visible-leaves-and-rejects-an-empty-key',
  'the-continuation-marker-at-an-item-s-own-column-and-what-follows-it',
  'a-continuation-marker-after-a-blank-line-in-the-item',
  'a-continuation-marker-after-a-blank-line-in-a-loose-item',
  'an-attribute-name-admits-no-colon',
  'an-inline-attribute-block-does-not-span-lines-but-an-attribute-line-does',
  'an-inline-attribute-block-does-not-span-lines-but-an-attribute-line-does',
  'trailing-whitespace-after-a-block-marker',
  'a-multi-line-raw-block-is-placed-at-its-opening-and-verbatim-after-it',
  'a-tab-as-the-first-character-of-a-definition-term',
  'an-abbreviation-term-is-one-ascii-alphanumeric-word',
  'a-definition-attached-by-a-continuation-marker-is-collected-and-the-item-keeps-no-trace',
  'a-definition-inside-a-definition-list-dd-is-collected-and-the-entry-keeps-no-trace',
  'a-line-at-a-footnote-definition-s-own-column-followed-by-non-blank-text-forms-its-own-tight-block',
  'a-tab-reaches-a-footnote-body-s-column-just-as-two-spaces-do',
  'a-footnote-body-s-last-block-when-it-is-not-a-paragraph-gets-a-synthesized-paragraph-for-the-backlink',
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
  'a-definition-inside-a-container-is-collected-at-that-container-s-content-column',
  'trailing-attributes-on-a-link-reference-definition',
  'a-block-attribute-line-inside-a-quote-ends-the-paragraph-above-it',
  'a-collapsed-image-reference-uses-its-alt-text-as-the-label',
  'a-combined-bold-italic-span-may-cross-a-line',
  'a-comment-ends-the-paragraph-it-sits-under',
  'a-definition-on-a-footnote-body-s-continuation-line-is-collected',
  'a-div-does-not-define-an-abbreviation-either',
  'a-flush-left-line-after-a-footnote-definition-belongs-to-the-document',
  'a-footnote-body-holds-blocks-and-they-render-where-they-were-written',
  'a-footnote-body-s-own-column-is-two-and-a-third-column-is-its-text',
  'a-definition-below-a-footnote-body-s-column-is-the-document-s-own-text',
  'a-definition-past-a-footnote-body-s-column-is-the-body-s-own-text',
  'a-heading-in-a-footnote-body-takes-an-id-but-no-section-wrapper',
  // The `[Café][]` half folds NFC, the `[file][]` half must NOT fold
  // compatibility - `# ﬁle` (U+FB01) stays unreachable. #694 landed the folding
  // half; this engine renders the fixture byte-for-byte, so the entry is the
  // whole change (carve#725, carve#729).
  'a-heading-reference-folds-unicode-normalization-but-not-compatibility',
  'a-nested-list-in-a-footnote-body-stays-nested',
  'a-quote-marker-is-plus-a-space-and-a-lazy-line-keeps-its-own-text',
  'a-reference-image-takes-a-caption',
  'an-attribute-line-inside-a-footnote-body-attaches-inside-it',
  'an-image-takes-a-reference-the-way-a-link-does',
  'an-unresolved-image-reference-stays-literal',
  'an-unresolved-reference-image-takes-no-caption',
  'one-definition-serves-a-link-and-an-image',
  'a-comment-fence-at-column-0-ends-the-item-a-line-does-not',
  'a-description-line-needs-a-term-above-it',
  'a-heading-id-keeps-a-non-ascii-space',
  'a-marker-attribute-may-hold-a-quoted-brace',
  'a-tag-inside-a-literal-brace-run-is-still-a-tag',
  'colon-fence-separator-must-be-a-space',
  'colon-fence-metadata-slots-must-be-a-space-too',
  'table-cell-padding-must-be-a-space',
  'link-and-image-title-slots-must-be-a-space',
  'code-fence-metadata-slots-must-be-a-space-too',
  'a-tab-continues-a-list-item-just-as-two-spaces-do',
  'an-absorbed-colon-fence-leaves-a-block-quote-s-paragraph-open',
  'a-blank-line-holds-spaces-and-tabs-and-nothing-else',
  'a-link-title-takes-exactly-one-space',
  'a-code-fence-opener-takes-exactly-one-space',
  'a-frontmatter-opener-takes-exactly-one-space',
  'a-reference-definition-s-metadata-slots-take-exactly-one-space',
  'a-reference-definition-is-anchored-at-end-of-line',
  'a-definition-marker-s-separator-is-a-space-and-it-is-a-run',
  'trailing-whitespace-on-a-content-line-is-dropped',
  'a-definition-body-continuation-indented-past-its-column-is-lazy-text',
  'a-real-div-in-a-container-and-the-flush-left-line-after-it',
  // Added with the spec bump that carries carve#975. Seven of these eight are
  // documents about rules this engine already implements, so they arrive here
  // green; the eighth, `a-list-marker-at-the-content-column-inside-an-open-fence`,
  // is the rule this bump implements.
  'a-below-column-marker-after-a-comment-where-no-paragraph-is-open',
  'a-collapsed-reference-reaches-a-heading-by-the-heading-s-rendered-text',
  'a-fence-opened-on-a-list-marker-line-body-below-the-content-column',
  'a-list-marker-at-the-content-column-inside-an-open-fence',
  'a-quoted-attribute-value-stops-at-the-newline',
  'an-autolink-body-admits-non-ascii-and-excludes-format-characters',
  'the-flush-left-line-after-a-container-a-quoted-line-opened',
  'the-inline-attribute-interior-is-space-only-the-attribute-line-is-not',
  // Added with the spec bump that carries carve#983 and carve#986: the rule
  // this bump implements. Its seven rows are seven collectors asked the same
  // question - a footnote body, a definition body, a block quote, a list item
  // and the `+` that attaches a flush-left block to each of them - and five of
  // them answered it wrong before, one per fence kind.
  'a-boundary-line-inside-an-open-fence-does-not-end-the-container',
  'a-fence-keeps-the-blank-line-at-the-end-of-its-content',
  'a-boolean-and-a-key-value-of-the-same-name-are-one-attribute',
  // Added with the spec bump that carries carve#1198. Only the last of these
  // is the rule this bump implements (PART 9R R2); the other nine are
  // documents this engine already rendered correctly, and the pin was simply
  // behind. Categories 310, 311 and 314-4 are the ones a fix keyed on
  // "brackets" rather than on "the text reached the reader" would break, so
  // they are listed here rather than left as silent todos.
  'a-captioned-quote-holds-more-than-one-block',
  'an-empty-inline-note-is-literal',
  'a-multi-letter-ordered-marker-opens-no-list',
  'a-note-s-content-recognizes-no-note',
  'a-footnote-in-link-text-nests-the-anchors',
  'a-footnote-in-reference-link-text-nests-the-anchors-too',
  'a-note-body-s-own-references-resolve',
  'a-reference-link-s-text-survives-its-own-frame',
  'an-inline-note-s-content-resolves-after-the-note',
  'a-footnote-in-an-unresolved-reference-is-not-a-reference',
  // The two categories markup-carve/carve#1206 adds. All twelve documents were
  // rendered and compared against their fixtures before either name was added:
  // this engine's READ path already closes an alt text at the matching `]`, so
  // every one of them matched byte for byte at the pin this commit moves off.
  // What was wrong was the WRITE path, which this commit fixes - four of the
  // twelve failed the formatter sweep in `render-carve.test.ts`, none the
  // renderer sweep here.
  'an-image-s-alt-text-closes-where-a-link-s-text-closes',
  'an-editorial-comment-s-bracket-is-content-not-the-close',
  // Category 319, the six documents that separate the cell-attribute orders.
  // Four of them (the attributed header cell, the header cell with an alignment
  // marker, the data cell with one, and the row composing cell blocks with a row
  // block) were rendered against this engine before the parser changed and did
  // not match; the other two (the retired order, and the ambiguous `|{#x}=R|`)
  // matched then and still do. All six match now.
  'cell-attributes-bind-after-the-kind-and-alignment-markers',
  // Category 320 arrives with the same submodule bump and needed no code: both
  // documents were rendered against this engine's HTML and `.fmt` outputs
  // before anything here changed, and both already matched.
  'the-canonical-writer-glues-a-code-fence-to-its-info-string',
  // Categories 321 to 324, the twenty-eight documents this pin bump brings in.
  // None of them needed engine work: the rules behind the first two already
  // landed here (delimited inline comments in `#1104`, the attribute block
  // reaching the nested list it precedes in `#1107`), and the other two are
  // documents about behavior this engine already had. Every one of the
  // twenty-eight was rendered through this engine and compared with its `.html`
  // fixture BEFORE its name was added - 28 of 28 byte-for-byte, so each entry
  // names a case that was already passing rather than one this list forces
  // green.
  'delimited-comments',
  'an-attribute-block-reaches-the-nested-list-it-precedes',
  'a-block-attached-after-an-invisible-line-leaves-the-item-tight',
  'an-abbreviation-definition-in-an-item-body-is-paragraph-text',
  // The pin bump to carve b6917ab adds TEN categories. Every document in all
  // ten - 69 of them - was rendered through this engine and compared with its
  // `.html` fixture before any name went in here. Only these five matched, and
  // only these five are listed: 26 of 26 documents byte-for-byte.
  //
  // The other five did NOT match, on 18 of their 43 documents, and they were
  // engine gaps rather than bookkeeping. They stayed out and the coverage guard
  // below stayed red - the one thing this list must never do is turn a real
  // divergence into a green run - until the engine work landed as `#1140`,
  // `#1141`, `#1142`, `#1143` and `#1144`. Their names are below, added the same
  // way: all 43 documents rendered through this engine and compared with their
  // `.html` fixtures first, 43 of 43 byte-for-byte, and the whole corpus at this
  // pin measured at 1124 of 1124 in the same run.
  'a-label-beginning-with-an-at-sign-is-not-a-reference-label',
  'a-tab-after-a-fence-or-a-frontmatter-opener-depends-on-where-it-sits',
  'an-attribute-line-after-a-continuation-marker-attributes-the-attached-block',
  'an-unclosed-inline-run-in-a-line-block-reaches-the-end-of-the-block',
  'a-comment-only-line-in-a-line-block-is-removed-before-any-inline-run',
  'a-line-block-s-hard-break-keeps-its-backslash',
  'a-line-block-s-last-body-line-keeps-its-backslash',
  'which-inline-content-a-heading-id-is-derived-from',
  'a-column-0-line-after-a-container-s-last-block-when-that-block-left-no-paragraph-open',
  'a-continuation-marker-attaches-one-block-and-the-boundary-is-that-block-s-extent',
  'an-unclosed-verbatim-run-in-a-row-stops-at-the-closing-pipe',
  'a-floating-attribute-is-scoped-to-the-container-that-holds-it',
  'a-continuation-row-s-open-run-and-an-escaped-closing-pipe',
  // The pin bump to carve 8b80822 adds SEVEN categories, one document each -
  // markup-carve/carve#1311, which pins that a comment fence hides its body at
  // every column and not only at column 0. Every one of the seven was rendered
  // through this engine and compared with its `.html` fixture BEFORE its name
  // went in here: 7 of 7 byte-for-byte, and the whole corpus at this pin
  // measured 1131 of 1131 in the same run. No engine work was needed - the
  // prepass here already treats a comment fence as opaque wherever it is
  // opened, so each entry names a case that was already passing rather than
  // one this list forces green.
  'a-comment-fence-at-an-item-s-content-column-registers-nothing-either',
  'a-comment-fence-reached-through-a-quote-registers-nothing-either',
  'a-footnote-definition-inside-an-item-s-comment-registers-nothing',
  'a-comment-fence-opened-on-an-item-s-marker-line-hides-its-body-too',
  'a-comment-fence-one-item-deeper-registers-nothing-either',
  'a-wider-comment-fence-inside-an-item-hides-its-body-the-same-way',
  'an-abbreviation-inside-a-comment-defines-nothing',
  'a-comment-fence-inside-a-colon-container-registers-nothing',
  // The pin bump to carve 483bcea adds ONE category of TEN documents -
  // markup-carve/carve#1320, the token-wise probe for the four URL-list
  // attributes. This one is NOT bookkeeping: the renderer read only the value's
  // leading scheme, so `srcset="safe.png 1x, javascript:alert(1) 2x"` rendered
  // verbatim while the same value with the payload first was blanked. SEVEN of
  // the ten documents were red before `sanitizeAttrValue` learned to tokenize;
  // the other three are the leading-position value the old rule already blanked
  // and the two that must be KEPT (a `ping` carrying a comma in its path, and a
  // `title` carrying prose colons).
  // All ten were then rendered through this engine and compared with their
  // `.html` fixtures BEFORE this name went in - 10 of 10 byte-for-byte, and the
  // whole corpus at this pin measured 1141 of 1141 in the same run.
  //
  // The pin bump to carve 5951e6d adds NO category. It adds two documents to
  // the category above - markup-carve/carve#1328, which amends section 25 to
  // say the token pass runs IN ADDITION TO the value-wide probe rather than
  // instead of it, and pins that with a `ping` and a `srcset` whose ONLY
  // payload sits in the leading token. Those two are the only corpus documents
  // that tell a token-only implementation apart from an additive one, so the
  // pin had to move for them to be measured at all. Both were rendered through
  // this engine and compared with their `.html` fixtures: 2 of 2
  // byte-for-byte, no engine work needed, because `#1164` already probed the
  // whole value alongside every token. The corpus measured 1143 of 1143 in the
  // same run.
  'url-list-attributes-are-probed-token-wise',
  // markup-carve/carve#1330. A line's content position is after its container
  // prefix, so PART 11 section 8b M2b is answered where the block writes its
  // own line rather than on the finished document, and `> \# heading` keeps the
  // escape the author wrote instead of coming back through an importer as a
  // heading. 2 of 2 documents and both `.md` sidecars byte-for-byte. The
  // narrowing is pinned in the same pair and still holds: `> C\# is a language`
  // and `- \#tag rest` drop their escapes exactly as they do outside a
  // container.
  'an-escaped-hash-keeps-its-escape-at-a-container-s-content-position',
  // The pin bump to carve 4bf77a3 adds FOUR categories of ELEVEN documents, and
  // none of them is engine work here: all eleven were rendered through this
  // engine and compared with their `.html` fixtures before these names went in,
  // 11 of 11 byte-for-byte, and the whole corpus measured 1256 of 1256 in the
  // same run.
  //
  // markup-carve/carve#1370 - five documents. A paragraph opened after a block
  // inside an item is still open for a lazy line below it, so a column-0 line
  // continues it rather than ending the item. carve-rs and carve-php both
  // lagged this one; this engine already answered all five.
  'a-paragraph-opened-after-a-block-in-an-item-is-still-open-for-a-lazy-line',
  // markup-carve/carve#1379 - three documents, and a clarification rather than a
  // new clause: a blank line ends the open paragraph WHATEVER container stands
  // above it, so an unterminated `:::` div reaches no further past a blank than
  // a terminated one, an opaque body, a quote, or no container at all.
  'an-unterminated-container-does-not-extend-the-item-past-a-blank-line',
  // markup-carve/carve#1385 - one document. An item's checkbox is decided by the
  // marker, not by whatever its first block turns out to be.
  'a-task-item-s-checkbox-is-not-decided-by-its-first-block',
  // markup-carve/carve#1386 - two documents. A marker-line colon opener is
  // demoted by LAZY FOLDING and by nothing else, so an opener that reaches its
  // container stays an opener whatever sits below it.
  'only-lazy-folding-demotes-a-marker-line-colon-opener',
  // The pin bump to carve 22f7f47 adds ONE category of THREE documents, and no
  // engine work here either: all three were rendered through this engine and
  // compared with their `.html` fixtures before this name went in, 3 of 3
  // byte-for-byte, and the whole corpus measured 1259 of 1259 in the same run.
  //
  // markup-carve/carve#1388, closing markup-carve/carve#1383 - a blank line
  // before a sibling marker separates the items whatever consumed it, so a
  // blank an item's own unterminated interior swallowed still reaches the
  // section 17 L1 looseness decision. The freeze measured all six container
  // kinds; this engine already loosened every one of them, and it also starts
  // the new list where the third document changes the bullet.
  'a-blank-line-before-a-sibling-marker-separates-the-items-whatever-consumed-it',
  // markup-carve/carve#1377. A heading at an item's content column is a
  // bounded block and leaves no paragraph open for a flush-left line.
  'a-heading-at-an-item-s-content-column-leaves-no-paragraph-open',
])

/**
 * Documents this engine has DELIBERATELY moved PAST the pinned corpus on.
 *
 * The spec repo declares the mirror of this window in
 * `resources/engine-pin-drift.txt`: a corpus that is ahead of an engine is a
 * normal state, and what is not normal is not knowing which window you are in.
 * This is the other direction - an ENGINE ahead of a pinned corpus, which
 * happens whenever a rule lands here between two `bump-carve-pin` runs.
 *
 * Each entry FAILS IN BOTH DIRECTIONS, which is the whole point:
 *
 *  - the output must equal the value the CURRENT spec states, so a regression
 *    in the engine is caught exactly as the corpus would have caught it;
 *  - and it must still DIFFER from the pinned golden, so an entry that has gone
 *    stale - the pin moved and the fixture was rewritten - fails and has to be
 *    deleted in the same commit that moves the pin.
 */
const AHEAD_OF_PIN = new Map<string, { reason: string; html: string }>()



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

/*
 * AN ENTRY THAT NAMES NOTHING IS NOT A PASS.
 *
 * The two assertions below only run for an entry whose slug is IN the corpus,
 * so a declaration left behind after an upstream RENAME - which is what a spec
 * change does to a category whose section title moved - matched no case, ran no
 * assertion, and read as coverage. That is how the tier-split entries survived
 * the bump that made them stale: `293-a-semantic-span-keeps-its-wrapper-…`
 * became `293-a-semantic-name-renames-the-span-…` upstream, and nine entries
 * quietly stopped being checked in either direction.
 */
describe('AHEAD_OF_PIN', () => {
  it('names only corpus cases that exist', () => {
    const orphaned = [...AHEAD_OF_PIN.keys()].filter((slug) => !pairs.includes(slug))
    expect(orphaned, 'renamed upstream, or already retired - either way the entry asserts nothing').toEqual([])
  })
})

describe('spec corpus population', () => {
  it('matches the independently derived example count', () => {
    expect(pairs.length).toBe(expectedCorpusSize(resolve(__dirname, '../spec')))
  })
})

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
    const ahead = AHEAD_OF_PIN.get(name)

    if (ahead) {
      it(`${name} (ahead of the pinned corpus)`, () => {
        const actual = carveToHtml(source).trim()
        expect(actual, ahead.reason).toBe(ahead.html)
        // The staleness half: when the pin moves past this rule the fixture is
        // rewritten to exactly this value, and the entry must be deleted.
        expect(
          expected.trim(),
          `${name} now matches: delete its AHEAD_OF_PIN entry`,
        ).not.toBe(ahead.html)
      })
      continue
    }

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
