import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

/**
 * NO TRAILING WHITESPACE (PART 2, NORMATIVE; markup-carve/carve#926).
 *
 * A `whitespace` run at the END OF A CONTENT LINE is DROPPED. It does not reach
 * the output and it is not content. Two things are new for an engine that
 * already stripped a paragraph's FINAL line: it holds on EVERY line, including
 * one before a SOFT BREAK, and it holds in every block, not only a paragraph.
 *
 * The corpus carries twelve documents. This is the CROSS PRODUCT the ticket
 * describes - every context the clause names against the character table - and
 * it is what found the sites the corpus does not reach: a definition TERM, which
 * dropped a whole Unicode run, and a form feed, which was dropped from a heading
 * and a caption.
 */

// Every content-line context the clause names.
const CONTEXTS: Array<[string, (t: string) => string]> = [
  ['a paragraph, final line', (t) => `abc${t}\n`],
  ['a paragraph, before a soft break', (t) => `abc${t}\ndef\n`],
  ['a heading', (t) => `# T${t}\n`],
  ['a list item', (t) => `- i${t}\n`],
  ['a list item, before a soft break', (t) => `- i${t}\n  more\n`],
  ['a block quote line', (t) => `> q${t}\n`],
  ['a block quote, before a soft break', (t) => `> q${t}\n> more\n`],
  ['a definition term', (t) => `:: t${t}\n:  d\n`],
  ['a definition description', (t) => `:: t\n:  d${t}\n`],
  ['a footnote body', (t) => `x[^f]\n\n[^f]: n${t}\n`],
  ['a footnote body, before a soft break', (t) => `x[^f]\n\n[^f]: n${t}\n  more\n`],
  ['a table caption', (t) => `| a |\n^ C${t}\n`],
  ['a div body', (t) => `::: note\nabc${t}\n:::\n`],
]

describe('a trailing space or tab is dropped on every content line', () => {
  for (const [name, build] of CONTEXTS) {
    it(`drops the run from ${name}`, () => {
      // The PROPERTY, not a literal: the document with the run and the document
      // without it are the same document.
      for (const run of [' ', '\t', '  ', ' \t', '\t ', '   ']) {
        expect(carveToHtml(build(run))).toBe(carveToHtml(build('')))
      }
    })
  }
})

describe('and nothing else is dropped, however invisible', () => {
  // carve#926's own table. U+FEFF was the red herring the ticket names: it is
  // content here like the rest, and only a SINGLE LEADING one at the very start
  // of a document is stripped, which is a separate rule (carve#872).
  const KEPT: Array<[string, number]> = [
    ['U+00A0 NO-BREAK SPACE', 0x00a0],
    ['U+200B ZERO WIDTH SPACE', 0x200b],
    ['U+FEFF BYTE ORDER MARK', 0xfeff],
    ['U+2000 EN QUAD', 0x2000],
    ['U+3000 IDEOGRAPHIC SPACE', 0x3000],
    ['U+000C FORM FEED', 0x000c],
    ['U+000B VERTICAL TAB', 0x000b],
    ['U+0085 NEXT LINE', 0x0085],
    ['U+2028 LINE SEPARATOR', 0x2028],
    ['U+205F MEDIUM MATHEMATICAL SPACE', 0x205f],
  ]

  for (const [name, code] of KEPT) {
    it(`keeps a trailing ${name} in every context`, () => {
      const c = String.fromCodePoint(code)
      for (const [, build] of CONTEXTS) {
        expect(carveToHtml(build(c))).not.toBe(carveToHtml(build('')))
      }
    })
  }

  it('drops the ASCII run around one of them without touching it', () => {
    // The two halves in one document: the space goes, the mark stays. This is
    // the shape the ticket was raised on.
    expect(carveToHtml(' ﻿ \n')).toBe('<p>﻿</p>')
  })
})

describe('verbatim content is not a content line', () => {
  it('keeps the run inside a code block', () => {
    expect(carveToHtml('```\nabc \n```\n')).toContain('abc ')
  })

  it('keeps the run inside a code span', () => {
    expect(carveToHtml('`x ` and !`y `\n')).toBe('<p><code>x </code> and y </p>')
  })

  it('keeps an ESCAPED space at a line end, which is content and not a run', () => {
    // The escape `\\ ` is this language's non-breaking space, so the space it
    // names is a character the author wrote and the run stops at it.
    //
    // Missing this does not lose a character, it changes the BLOCK: dropping the
    // space leaves a bare backslash at the end of the line, and a bare backslash
    // at the end of a line is a HARD BREAK. So the author's no-break space came
    // out as a line break. Raised by codex review on the change that widened
    // this rule to every line - and it was already true at the block-FINAL
    // position the narrower rule reached, so this was a live defect before it.
    expect(carveToHtml('a\\ \nb\n')).toBe('<p>a&nbsp;\nb</p>')
    expect(carveToHtml('a\\ \n')).toBe('<p>a&nbsp;</p>')
    expect(carveToHtml('a\\ \\ \nb\n')).toBe('<p>a&nbsp;&nbsp;\nb</p>')
    // Only the FIRST character of the run can be the escaped one; the rest is
    // ordinary trailing whitespace and still goes.
    expect(carveToHtml('a\\   \nb\n')).toBe(carveToHtml('a\\ \nb\n'))
    // An EVEN run of backslashes is a literal backslash, so the space after it
    // is not escaped and does go.
    expect(carveToHtml('a\\\\ \nb\n')).toBe(carveToHtml('a\\\\\nb\n'))
  })

  it('keeps the run before a backslash hard break, which is not trailing', () => {
    // The backslash is the last character on the line, so the space before it
    // is interior. Carve has no two-trailing-space hard break, which is exactly
    // why dropping the run cannot destroy one.
    expect(carveToHtml('a \\\nb\n')).toBe('<p>a <br>\nb</p>')
  })

  it('keeps a line block gap of two or more columns, which is already content', () => {
    // Section 23's MEDIAL GAPS converts an inner or trailing run of TWO OR MORE
    // columns into non-breaking-space CONTENT before this rule is reached, so
    // only a ONE-column trailing run is left for it to drop.
    expect(carveToHtml('::: |\nabc  \ndef \n:::\n')).toBe(
      '<div class="line-block">\n  <p>abc&nbsp;&nbsp;<br>\ndef</p>\n</div>',
    )
  })
})
