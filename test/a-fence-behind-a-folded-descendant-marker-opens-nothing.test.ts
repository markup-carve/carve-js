import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A marker inside a descendant item's marker width folds into its paragraph as
// text, so the fence behind it opens nothing and a column-0 line continues the
// same paragraph (carve#4371).
const nested = (outer: string, fold: string, payload: string): string => {
  const pad = ' '.repeat(outer.length)
  return `${outer}- a\n${pad}  - y\n${pad}   ${fold}${payload}\nz\n`
}

describe('a fence behind a folded descendant marker opens nothing (carve#4371)', () => {
  for (const outer of ['1. ', '- ', 'a) ', '- [ ] ']) {
    for (const payload of ['~~~', '```', '~~~~ js']) {
      it(`${JSON.stringify(outer)} outer, ${payload} payload`, () => {
        const html = carveToHtml(nested(outer, '1. ', payload))
        expect(html).not.toContain('<p>z</p>')
        expect(html).toMatch(/<li>y\n1\.[^]*z[^]*?<\/li>\n *<\/ul>/)
      })
    }
  }

  it('renders the reported shape', () => {
    expect(carveToHtml('1. - a\n     - y\n      1. ~~~\nz\n')).toContain('<li>y\n1. ~~~\nz</li>')
  })

  it('still ends the paragraph after a folded heading', () => {
    expect(carveToHtml('1. - a\n     - y\n      1. # h\nz\n')).toContain('<p>z</p>')
  })
})
