import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

// A wrapped attribute opener indented below the item's content column is an
// attribute line like the one-line form, so it ends the item (carve#4089).
describe('a below-column wrapped attribute opener', () => {
  it('ends the nested item', () => {
    expect(h('- - a\n {c\n}\nx\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>\n<p c="">x</p>',
    )
  })

  it('ends a single item, and an item inside a quote', () => {
    expect(h('- a\n {c\n}\nx\n')).toBe('<ul>\n  <li>a</li>\n</ul>\n<p c="">x</p>')
    expect(h('> 1. a\n>  {c\n> }\n> x\n')).toBe('<blockquote>\n  <ol>\n    <li>a</li>\n  </ol>\n  <p c="">x</p>\n</blockquote>')
  })

  it('ends the items when an enclosing item admitted it below its column', () => {
    expect(h('10. - a\n  {c\n}\nx\n')).toBe(
      '<ol start="10">\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ol>\n<p c="">x</p>',
    )
  })

  it('closes the paragraph at the outer item content column, and x leaves the list', () => {
    expect(h('- - a\n   {c\n}\nx\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a</li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>',
    )
  })
})
