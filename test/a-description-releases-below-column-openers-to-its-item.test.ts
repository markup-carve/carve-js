import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a description releases below-column openers to its item', () => {
  it('keeps a past-column separator in the new term', () => {
    expect(carveToHtml('- a\n  :: term\n  :  detail\n   :: term\n    :  detail\n      [^n]: note\n       q\n1. ordered\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>term</dt>\n      <dd>detail</dd>\n      <dt>term\n :  detail\n   [^n]: note\n    q</dt>\n    </dl>\n  </li>\n</ul>\n<ol>\n  <li>ordered</li>\n</ol>',
    )
  })

  it('opens a quote after leaving the second description', () => {
    expect(carveToHtml('- a\n  :: term\n  :  detail\n    :: term\n    :  detail\n      > quote\n  +  \ntext\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>term</dt>\n      <dd>detail</dd>\n      <dt>term</dt>\n      <dd>detail</dd>\n    </dl>\n    <blockquote><p>quote\n+\ntext</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('keeps the authored bases of sibling lists', () => {
    expect(carveToHtml('* [ ] task\n  :: term\n  :  detail\n    :: term\n    :  detail\n      - a\n     +  \n\n     - item\n')).toBe(
      '<ul class="task-list">\n  <li><input type="checkbox" disabled aria-label="task"> task\n    <dl>\n      <dt>term</dt>\n      <dd>detail</dd>\n      <dt>term</dt>\n      <dd>detail</dd>\n    </dl>\n    <ul>\n      <li>a\n+</li>\n    </ul>\n    <ul>\n      <li>item</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
