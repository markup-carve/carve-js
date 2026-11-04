import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve#5080: a continuation at or below the brace column leaves the run as paragraph text.
describe('a below-column wrapped attribute opener', () => {
  it.each([
    ['- - a\n {c\n}\nx\n', '<ul>\n  <li>\n    <ul>\n      <li>a\n{c\n}\nx</li>\n    </ul>\n  </li>\n</ul>'],
    ['- a\n {c\n}\nx\n', '<ul>\n  <li>a\n{c\n}\nx</li>\n</ul>'],
    ['> 1. a\n>  {c\n> }\n> x\n', '<blockquote>\n  <ol>\n    <li>a\n{c\n}\nx</li>\n  </ol>\n</blockquote>'],
    ['10. - a\n  {c\n}\nx\n', '<ol start="10">\n  <li>\n    <ul>\n      <li>a\n{c\n}\nx</li>\n    </ul>\n  </li>\n</ol>'],
    ['- - a\n   {c\n}\nx\n', '<ul>\n  <li>\n    <ul>\n      <li>a\n{c\n}\nx</li>\n    </ul>\n  </li>\n</ul>'],
  ])('renders %j as paragraph text', (source, expected) => {
    expect(carveToHtml(source)).toBe(expected)
  })
})
