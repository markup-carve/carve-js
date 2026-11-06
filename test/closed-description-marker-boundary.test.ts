import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('definition marker boundary after a description closes', () => {
  it('folds a marker-column line into a later item paragraph', () => {
    expect(carveToHtml('- a\n  :: t\n  : u\n\n  p\n: c\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <dl>\n      <dt>t</dt>\n      <dd>u</dd>\n    </dl>\n    <p>p\n: c</p>\n  </li>\n</ul>',
    )
  })

  it('keeps the boundary while the description is still open', () => {
    expect(carveToHtml('- a\n  :: t\n  : u\n  p\n: c\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n      <dd>u\np</dd>\n    </dl>\n  </li>\n</ul>\n<p>: c</p>',
    )
  })

  it('keeps the boundary for a term without a description', () => {
    expect(carveToHtml('- a\n  :: t\n  # H\n  w\n: z\n')).toBe(
      '<ul>\n  <li>a\n    <dl>\n      <dt>t</dt>\n    </dl>\n    <h1 id="H">H</h1>\n    w\n  </li>\n</ul>\n<p>: z</p>',
    )
  })

  it('lets a nested item paragraph take the line after the description closes', () => {
    expect(carveToHtml('- a\n  :: t\n  : u\n\n  - x\n: c\n')).toBe(
      '<ul>\n  <li><p>a</p>\n    <dl>\n      <dt>t</dt>\n      <dd>u</dd>\n    </dl>\n    <ul>\n      <li>x\n: c</li>\n    </ul>\n  </li>\n</ul>',
    )
  })
})
