import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const backlink = (n: number): string =>
  `<a href="#fnref${n}" role="doc-backlink" aria-label="Back to reference">↩</a>`

describe('a refused second marker ends a marker-line note in an item (carve#5515)', () => {
  it('opens the quote below the blank in the item', () => {
    expect(carveToHtml('- h\n  [^a]: +\n  +\n\n    > q\n')).toBe(
      '<ul>\n  <li><p>h</p>\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>')
  })

  it('reads a quoted item the same way', () => {
    const html = carveToHtml('> - h\n>   [^a]: +\n>   +\n>\n>     > q\n\nx[^a]\n')
    expect(html).toContain('<li><p>h</p>\n      <blockquote><p>q</p></blockquote>\n    </li>')
    expect(html).toContain(`<li id="fn1">\n      <p>${backlink(1)}</p>`)
  })
})
