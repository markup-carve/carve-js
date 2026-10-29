import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const h = (s: string) => carveToHtml(s)

// A wrapped attribute opener indented below the item's content column is lazy
// paragraph text, so its closer ends no paragraph (PART 0 O2, O3, carve-js#3855).
describe('a below-column wrapped attribute opener', () => {
  it('keeps the next lazy line in the nested paragraph', () => {
    expect(h('- - a\n {c\n}\nx\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n{c\n}\nx</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('stays text in a single item and inside a quote', () => {
    expect(h('- a\n {c\n}\nx\n')).toBe('<ul>\n  <li>a\n{c\n}\nx</li>\n</ul>')
    expect(h('> 1. a\n>  {c\n> }\n> x\n')).toBe('<blockquote>\n  <ol>\n    <li>a\n{c\n}\nx</li>\n  </ol>\n</blockquote>')
  })

  it('stays text when an enclosing item admitted it below its column', () => {
    expect(h('10. - a\n  {c\n}\nx\n')).toBe(
      '<ol start="10">\n  <li>\n    <ul>\n      <li>a\n{c\n}\nx</li>\n    </ul>\n  </li>\n</ol>',
    )
  })

  it('still closes the paragraph at the outer item content column', () => {
    expect(h('- - a\n   {c\n}\nx\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n{c\n}</li>\n    </ul>\n  </li>\n</ul>\n<p>x</p>',
    )
  })
})
