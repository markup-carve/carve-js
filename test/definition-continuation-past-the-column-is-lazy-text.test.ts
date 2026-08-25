import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

/**
 * A recognized block opener indented past the definition body's minimum column
 * establishes an authored local block base (markup-carve/carve#1729).
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

describe('past the body column, an opener establishes an authored base', () => {
  for (const [name, opener, marker] of OPENERS) {
    it(`nests ${name}`, () => {
      const src = `:: t\n:  body\n${opener.split('\n').map((l) => PAST + l).join('\n')}\n`

      expect(carveToHtml(src)).toContain(marker)
    })

    it(`CONTROL: nests ${name} AT the body column`, () => {
      // Without this the rule would read as "an indented opener is never a
      // block", which is a different rule and the wrong one.
      const src = `:: t\n:  body\n${opener.split('\n').map((l) => AT + l).join('\n')}\n`

      expect(carveToHtml(src)).toContain(marker)
    })
  }

  it('renders the corpus shape as a structural quote', () => {
    expect(carveToHtml(':: t\n:  body\n    > q\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>\n    <p>body</p>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>',
    )
  })

  it('CONTROL: flush left the body ends and the quote is a sibling', () => {
    // The column on the other side, so the change is bounded on both.
    expect(carveToHtml(':: t\n:  body\n> q\n')).toBe(
      '<dl>\n  <dt>t</dt>\n  <dd>body</dd>\n</dl>\n<blockquote><p>q</p></blockquote>',
    )
  })

  it('measures COLUMNS, so a tab and the four spaces it reaches agree', () => {
    expect(carveToHtml(':: t\n:  body\n\t> q\n')).toBe(carveToHtml(':: t\n:  body\n    > q\n'))
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
