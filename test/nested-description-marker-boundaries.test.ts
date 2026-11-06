import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('description markers at nested item boundaries', () => {
  it('opens a term in the middle item after an attached quote', () => {
    expect(carveToHtml('- - - > +\n      x\n    :: u\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>\n' +
      '            <blockquote><p>x</p></blockquote>\n' +
      '          </li>\n        </ul>\n        <dl>\n          <dt>u</dt>\n' +
      '        </dl>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('ends a nested item when a description marker reaches its marker column', () => {
    expect(carveToHtml('- a\n  - b\n    :: t\n    : d\n  : d\n')).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li>b\n        <dl>\n' +
      '          <dt>t</dt>\n          <dd>d</dd>\n        </dl>\n' +
      '      </li>\n    </ul>\n    : d\n  </li>\n</ul>',
    )
  })

  it('ends every item at a column-zero marker after a nested description list', () => {
    expect(carveToHtml('- a\n  - b\n    :: t\n    : u\n      - x\n: b\n')).toContain('</ul>\n<p>: b</p>')
  })
})
