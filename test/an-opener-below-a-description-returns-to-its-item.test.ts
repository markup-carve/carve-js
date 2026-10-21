import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('an opener below a description returns to its item', () => {
  it('opens a sibling list at the item column', () => {
    expect(carveToHtml('- a\n  :: t\n  :  d\n   - b\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd>d</dd>\n    </dl>\n    <ul>\n      <li>b</li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('opens a note outside a nested description', () => {
    expect(carveToHtml('- a\n  :: term\n  :  detail\n    :: term\n    :  detail\n      [^n]: note\n       q\n1. ordered\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>term</dt>\n      <dd>detail</dd>\n      <dt>term</dt>\n      <dd>detail</dd>\n    </dl>\n    q\n  </li>\n</ul>\n<ol>\n  <li>ordered</li>\n</ol>',
    )
  })

  it('folds a non-opener into the open description paragraph', () => {
    expect(carveToHtml('- a\n  :: t\n  :  d\n   plain\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd>d\nplain</dd>\n    </dl>\n  </li>\n</ul>',
    )
  })
})
