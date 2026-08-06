import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A blank line is space and tab and nothing else (markup-carve/carve#890).
 *
 * The grammar names the class twice over - `blank_line = {whitespace}, newline`
 * (grammar.ebnf:246) over `whitespace = ' ' | '\t'` (:2206) - and PART 1 states
 * the U+FEFF row of it outright: "ONE, and only there: a U+FEFF anywhere else is
 * an ordinary zero-width character" (:85-90).
 *
 * `isBlankLine` used to trim with `\s` minus U+00A0. JavaScript's `\s` is
 * Unicode White_Space PLUS U+FEFF MINUS U+0085 - a legacy set, not a property -
 * so twelve characters the grammar calls content ended a paragraph here, and a
 * U+FEFF ended one in this engine alone while rendering as ordinary text inside
 * a paragraph. Measured against carve-rs `2ec3c1c` and carve-php `876e312`.
 */
describe('a blank line', () => {
  // A line `a`, a line holding only `ch`, a line `b`. One paragraph means the
  // middle line was content and soft-broke into it; two means it was blank.
  const paragraphs = (ch: string) => carveToHtml(`a\n${ch}\nb\n`).match(/<p>/g)?.length ?? 0

  it('is ended by a space or a tab', () => {
    // The two characters `whitespace` names. Without this the class could be
    // narrowed to nothing and every document would become one paragraph.
    expect(paragraphs(' ')).toBe(2)
    expect(paragraphs('\t')).toBe(2)
    expect(paragraphs('  \t ')).toBe(2)
    expect(paragraphs('')).toBe(2)
  })

  it('is not ended by a byte order mark', () => {
    // The ticket's own row, and the one where this engine was the lone outlier:
    // carve-rs and carve-php both read it as content.
    expect(paragraphs('﻿')).toBe(1)
  })

  it('is not ended by any other Unicode space either', () => {
    // The same defect, one character wider. Every one of these is in JavaScript's
    // `\s` and none is in `whitespace`, so a fix written for U+FEFF alone would
    // leave eleven rows of the ticket's table diverging from carve-rs.
    for (const ch of [
      '', // LINE TABULATION
      '', // FORM FEED
      ' ', // OGHAM SPACE MARK
      ' ', // EN QUAD
      ' ', // THIN SPACE
      ' ', // HAIR SPACE
      ' ', // LINE SEPARATOR
      ' ', // PARAGRAPH SEPARATOR
      ' ', // NARROW NO-BREAK SPACE
      ' ', // MEDIUM MATHEMATICAL SPACE
      '　', // IDEOGRAPHIC SPACE
    ]) {
      expect({ ch: ch.codePointAt(0)!.toString(16), paragraphs: paragraphs(ch) }).toEqual({
        ch: ch.codePointAt(0)!.toString(16),
        paragraphs: 1,
      })
    }
  })

  it('is not ended by a RUN of them, in either order against a real space', () => {
    // The rule is about the whole RUN, so a check on the FIRST character alone
    // passes `<BOM><BOM><BOM>` and ` <BOM>` and fails `<BOM> `. All three are
    // content in carve-rs and carve-php.
    expect(paragraphs('﻿﻿﻿')).toBe(1)
    expect(paragraphs(' ﻿')).toBe(1)
    expect(paragraphs('﻿ ')).toBe(1)
    expect(paragraphs('\t ')).toBe(1)
    expect(paragraphs(' \t')).toBe(1)
  })

  it('was already right for the two characters the repo had narrowed', () => {
    // The CONTROL rows: U+00A0 was carved out of the old class by hand and
    // U+0085 is the one White_Space character JavaScript's `\s` omits, so both
    // read as content before this change and after it. They discriminate
    // nothing about the fix and are here to bound it.
    expect(paragraphs(' ')).toBe(1)
    expect(paragraphs('')).toBe(1)
    expect(paragraphs('​')).toBe(1)
  })

  it('does not change what a mark inside a line is', () => {
    // The other half of the contradiction the ticket named: the same character
    // has to stay ordinary content in the middle of a line.
    expect(carveToHtml('hel﻿lo\n')).toContain('hel﻿lo')
  })
})

/**
 * The same class, at the four blank-line decisions the definition-collection
 * prepass makes for itself. They were spelled `raw.trim() === ''`, which is the
 * legacy set again through `String.prototype.trim`, so the prepass and the block
 * lexer disagreed about where a blank line was.
 *
 * Every case below has the same shape, and it is the shape that makes this worth
 * pinning: the definition line RENDERS AS PROSE either way, so with the prepass
 * on the wider class the reader saw `[r]: /u` as text while a reference to it
 * silently resolved. Visible and active at once - the mirror of the "neither
 * visible nor active" outcome markup-carve/carve#624 named.
 */
describe('the definition prepass', () => {
  it('does not collect an abbreviation an item swallowed, after a mark line', () => {
    // `prevBlank`. With the mark line read as blank the prepass popped the
    // item's content column, so `*[A]: Ay` looked like a document-level
    // definition - and the item still rendered the same line as text.
    const html = carveToHtml('- item\n﻿\n*[A]: Ay\n\n[link][r] A text\n')

    expect(html).toContain('*[A]: Ay')
    expect(html).not.toContain('<abbr')
  })

  it('does not keep a footnote body open across a mark line', () => {
    // `inFootnoteBody`. A mark-only line at column 0 is content, so it leaves
    // the body; the indented `[r]: /u` is then below no open column and defines
    // nothing, which is what the rendered text already says.
    const html = carveToHtml('[^f]: note\n﻿\n  [r]: /u\n\n[link][r] text[^f]\n')

    expect(html).toContain('[r]: /u')
    expect(html).not.toContain('href="/u"')
  })

  it('does not keep a continuation marker open across a mark line', () => {
    // `plusColumn`. The `+` marker holds an item's content column open across a
    // blank; a mark line is not one, so the column closes with it.
    const html = carveToHtml('- item\n+\n﻿\n  [r]: /u\n\n[link][r] text\n')

    expect(html).toContain('[r]: /u')
    expect(html).not.toContain('href="/u"')
  })

  it('leaves the same three shapes alone when the line really is blank', () => {
    // The CONTROL for all three: with a genuine blank line each definition is
    // collected, so the assertions above are about the CLASS and not about
    // definition collection having been broken outright.
    expect(carveToHtml('- item\n\n*[A]: Ay\n\n[link][r] A text\n')).toContain('<abbr')
    expect(carveToHtml('[^f]: note\n\n  [r]: /u\n\n[link][r] text[^f]\n')).toContain('href="/u"')
    expect(carveToHtml('- item\n+\n\n  [r]: /u\n\n[link][r] text\n')).toContain('href="/u"')
  })
})
