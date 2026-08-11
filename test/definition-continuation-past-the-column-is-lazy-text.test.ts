import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

/**
 * A CONTINUATION INDENTED PAST THE BODY'S COLUMN IS LAZY TEXT
 * (markup-carve/carve#918).
 *
 * `definition_indent` REACHES the body's column and does not measure how far
 * past it a line went, because there is nothing past that column for
 * indentation to mean. So a line indented further continues the body's OPEN
 * PARAGRAPH, and a paragraph continuation carries inline content.
 *
 * Why not "extra indentation nests", from the signoff: that reading makes
 * indentation depth mean two different things one line apart - lazy
 * continuation already governs the line above and folds it into the same
 * paragraph, so a stray four-space indent would silently become a block quote.
 *
 * The corpus names the block QUOTE. It is not one opener: this engine stripped
 * the WHOLE indentation run, so a line at column 4 arrived flush at column 0,
 * byte-identical to one written at column 3 - and EVERY nesting opener gave the
 * same answer at both columns. Eight of them move.
 */

// The body's column is 3, the one `:  ` establishes.
const AT = '   '
const PAST = '    '

const OPENERS: Array<[string, string, string]> = [
  ['a block quote', '> q', '<blockquote>'],
  ['a heading', '# h', '<h1'],
  ['a thematic break', '---', '<hr>'],
  ['a table row', '| x |', '<table>'],
  ['a div fence', '::: n\n:::', '<div'],
  ['a definition term', ':: q', '<dt>q</dt>'],
]

describe('past the body column, a block opener is text', () => {
  for (const [name, opener, marker] of OPENERS) {
    it(`does not nest ${name}`, () => {
      const src = `:: t\n:  body\n${opener.split('\n').map((l) => PAST + l).join('\n')}\n`

      expect(carveToHtml(src)).not.toContain(marker)
    })

    it(`CONTROL: nests ${name} AT the body column`, () => {
      // Without this the rule would read as "an indented opener is never a
      // block", which is a different rule and the wrong one.
      const src = `:: t\n:  body\n\n${opener.split('\n').map((l) => AT + l).join('\n')}\n`

      expect(carveToHtml(src)).toContain(marker)
    })
  }

  it('uses a blank line to end the paragraph and open the nested quote', () => {
    expect(carveToHtml(":: t\n:  body\n\n   > q\n")).toContain('<blockquote>')
  })

  it('CONTROL: flush left the body ends and the quote is a sibling', () => {
    // The column on the other side, so the change is bounded on both.
    expect(carveToHtml(":: t\n:  body\n\n> q\n")).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n<blockquote><p>q</p></blockquote>',
    )
  })

  it('measures COLUMNS, so a tab and the four spaces it reaches agree', () => {
    expect(carveToHtml(":: t\n:  body\n\n   > q\n")).toBe(carveToHtml(":: t\n:  body\n\n   > q\n"))
  })

  it('still nests through the blank-line form, which is how a dd holds blocks', () => {
    // FORM A: a legitimately nested construct needs the
    // blank-line-then-indented-block form, and this rule must not touch it.
    expect(carveToHtml(':: t\n:  body\n\n   > q\n')).toContain('<blockquote>')
  })

  it('keeps a no-break space as content rather than counting it as a column', () => {
    // `sliceColumns` counts only spaces and tabs, so the scan stops at the
    // no-break space and it survives into the text.
    expect(carveToHtml(':: t\n:  body\n    x\n')).toContain('&nbsp;x')
  })
})
