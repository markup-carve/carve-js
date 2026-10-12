import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

describe('a marker-line colon opener always opens', () => {
  it('releases a flush-left tail and the paragraph after a blank (364-2)', () => {
    expect(carveToHtml(`- ::: d
tail

after
`)).toBe('<ul>\n  <li>\n    <div class="d">\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>\n<p>after</p>')
  })

  it('releases a below-column body and reads the later closer as text (482)', () => {
    expect(carveToHtml(`- :::
 y
  :::
`)).toBe('<ul>\n  <li>\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>y\n:::</p>')
  })

  it('releases unprefixed prose from both the quote and the list', () => {
    expect(carveToHtml(`> - ::: d
tail
`)).toBe('<blockquote>\n  <ul>\n    <li>\n      <div class="d">\n\n      </div>\n    </li>\n  </ul>\n</blockquote>\n<p>tail</p>')
  })
})
