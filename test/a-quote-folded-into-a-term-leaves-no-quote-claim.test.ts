import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a quote folded into term text leaves no quote claim', () => {
  it('lets a later list marker open in the enclosing item', () => {
    const source = '1. ordered\n   :: term\n  :  detail\n    > quote\n\tq\n        - item\n'
    expect(carveToHtml(source)).toBe('<ol>\n  <li>ordered\n    <dl>\n      <dt>term\n:  detail\n &gt; quote\n q</dt>\n    </dl>\n    <ul>\n      <li>item</li>\n    </ul>\n  </li>\n</ol>')
  })

  it('does not make the claim depend on the later list marker spelling', () => {
    const source = '1. ordered\n   :: term\n  :  detail\n    > quote\n        * item\n'
    expect(carveToHtml(source)).toBe('<ol>\n  <li>ordered\n    <dl>\n      <dt>term\n:  detail\n &gt; quote</dt>\n    </dl>\n    <ul>\n      <li>item</li>\n    </ul>\n  </li>\n</ol>')
  })
})
