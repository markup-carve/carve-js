import { describe, expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

describe('leading tabs in a list frame', () => {
  it('opens a quote reached by a nested item', () => {
    expect(carveToHtml('- - a\n  \t> b\n')).toBe(
      '<ul>\n  <li>\n    <ul>\n      <li>a\n        <blockquote><p>b</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ul>',
    )
  })

  it('keeps sibling markers in the same remeasured frame', () => {
    const source = '- a\n     - b\n\n  \t- c\n  \t- d\n'
    expect(carveToHtml(source)).toBe(
      '<ul>\n  <li>a\n    <ul>\n      <li><p>b</p></li>\n      <li><p>c</p></li>\n      <li><p>d</p></li>\n    </ul>\n  </li>\n</ul>',
    )
    expect(lintCarve(source).filter(warning => warning.rule === 'list-marker-below-content-column')
      .map(warning => [warning.line, warning.column])).toEqual([[4, 4], [5, 4]])
  })

  it('uses the marker-line frame in a wider ordered ladder', () => {
    expect(carveToHtml('1. - a\n   \t> b\n')).toBe(
      '<ol>\n  <li>\n    <ul>\n      <li>a\n        <blockquote><p>b</p></blockquote>\n      </li>\n    </ul>\n  </li>\n</ol>',
    )
  })
})
