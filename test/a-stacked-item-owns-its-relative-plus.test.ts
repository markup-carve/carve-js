import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const cases = [
  ['bullet', '- - b\n\n  +\n  tail\n', '<ul>\n  <li>\n    <ul>\n      <li>b\n        tail\n      </li>\n    </ul>\n  </li>\n</ul>'],
  ['ordered', '- 1. b\n\n  +\n  tail\n', '<ul>\n  <li>\n    <ol>\n      <li>b\n        tail\n      </li>\n    </ol>\n  </li>\n</ul>'],
  ['quoted', '> - - b\n>\n>   +\n>   tail\n', '<blockquote>\n  <ul>\n    <li>\n      <ul>\n        <li>b\n          tail\n        </li>\n      </ul>\n    </li>\n  </ul>\n</blockquote>'],
] as const

describe('a stacked item owns its physical marker column', () => {
  it.each(cases)('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
