import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5792 (nested-item variant), carve#5830 rule A: a refused brace run left of a nested item's
// body is that item's lazy paragraph text, so the item keeps the lines its column owns.
describe('a refused brace run on lazy lines of a nested item', () => {
  const nested = (run: string) =>
    '<ul>\n  <li>p\n    <ul>\n      <li>a\n' + run + '\n        <h1 id="q">q</h1>\n      </li>\n    </ul>\n  </li>\n</ul>\n<p>after</p>'

  it('keeps the heading in the nested item and ends the list at a column-0 line', () => {
    expect(carveToHtml('- p\n  - a\n   {.a\n   .b}\n    # q\nafter\n')).toBe(nested('{.a\n.b}'))
  })

  it('reads a comment run the same way', () => {
    expect(carveToHtml('- p\n  - a\n   {% a\n   %}\n    # q\nafter\n')).toBe(nested('{% a\n%}'))
  })

  it('leaves a run its closer makes valid to the outer item', () => {
    expect(carveToHtml('- p\n  - a\n   {.a\n    .b}\n    # q\nafter\n')).toBe(
      '<ul>\n  <li>p\n    <ul>\n      <li>a</li>\n    </ul>\n    <h1 class="a b" id="q">q</h1>\n  </li>\n</ul>\n<p>after</p>')
  })
})
