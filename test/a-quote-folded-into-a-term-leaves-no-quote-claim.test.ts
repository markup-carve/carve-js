import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a quote folded into term text leaves no quote claim', () => {
  it('keeps a later list marker in the quote', () => {
    const source = '1. ordered\n   :: term\n  :  detail\n    > quote\n\tq\n        - item\n'
    expect(carveToHtml(source)).toBe('<ol>\n  <li>ordered\n    <dl>\n      <dt>term\n:  detail</dt>\n    </dl>\n    <blockquote><p>quote\nq\n- item</p></blockquote>\n  </li>\n</ol>')
  })

  it('does not make the claim depend on the later list marker spelling', () => {
    const source = '1. ordered\n   :: term\n  :  detail\n    > quote\n        * item\n'
    expect(carveToHtml(source)).toBe('<ol>\n  <li>ordered\n    <dl>\n      <dt>term\n:  detail</dt>\n    </dl>\n    <blockquote><p>quote\n* item</p></blockquote>\n  </li>\n</ol>')
  })
})
