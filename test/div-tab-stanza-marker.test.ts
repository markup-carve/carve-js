import { describe, expect, it } from 'vitest'
import { format, render, renderWithDiagnostics } from '../public/index.ts'

describe('C2-B-119, C2-B-122: a tab behind the spaces of a div opener', () => {
  it('opens an anonymous div and reports the words behind the tab', () => {
    const out = renderWithDiagnostics('::: \tnote\nx\n:::\n')
    expect(out.html).toBe('<div>\n  <p>x</p>\n</div>')
    expect(out.diagnostics.map((d) => [d.code, d.range?.startOffset])).toEqual([['fence-title-syntax', 5]])
  })

  it('reads no sigil behind the tab', () => {
    expect(render('::: \t|\nx\n:::\n')).toBe('<div>\n  <p>x</p>\n</div>')
    expect(render('::: \t>\nx\n:::\n')).toBe('<div>\n  <p>x</p>\n</div>')
  })

  it('leaves a run followed only by spaces and tabs bare', () => {
    expect(renderWithDiagnostics(':::  \t\nx\n:::\n').diagnostics).toEqual([])
  })

  it('interrupts a paragraph and is escaped where it is text', () => {
    expect(render('a\n::: \tnote\nx\n:::\n')).toBe('<p>a</p>\n<div>\n  <p>x</p>\n</div>')
    expect(format('a\n\\::: \tx\n')).toBe('a\n\\::: \tx\n')
  })
})

describe('C2-B-024, C2-B-015: a list marker below a stanza in an item', () => {
  const stanza = '<ul>\n  <li>\n    <div class="line-block">\n      <p>a</p>\n    </div>\n  </li>\n'

  it('starts a new item at the column of the list', () => {
    expect(render('- ::: |\n  a\n- z\n')).toBe(`${stanza}  <li>z</li>\n</ul>`)
  })

  it('closes the list for a marker of another type', () => {
    expect(render('- ::: |\n  a\n1. z\n')).toBe(`${stanza}</ul>\n<ol>\n  <li>z</li>\n</ol>`)
  })

  it('stays a lazy line where interrupter (b) does not take the marker', () => {
    expect(render('- ::: |\n  a\n+ z\n')).toContain('<p>a<br>\n+ z</p>')
  })
})
