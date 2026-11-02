import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A marker inside a descendant item's marker width reads as at its marker column
// (carve#4545), so the fence behind it opens and a column-0 line leaves the list.
const nested = (outer: string, fold: string, payload: string): string => {
  const pad = ' '.repeat(outer.length)
  return `${outer}- a\n${pad}  - y\n${pad}   ${fold}${payload}\nz\n`
}

describe('a fence behind a marker in a descendant item\'s marker width opens', () => {
  for (const outer of ['1. ', '- ', 'a) ', '- [ ] ']) {
    for (const payload of ['~~~', '```', '~~~~ js']) {
      it(`${JSON.stringify(outer)} outer, ${payload} payload`, () => {
        const html = carveToHtml(nested(outer, '1. ', payload))
        expect(html).toContain('<li>y</li>')
        expect(html).toContain('<pre><code')
      })
    }
  }

  it('renders the reported shape', () => {
    expect(carveToHtml('1. - a\n     - y\n      1. ~~~\nz\n')).toContain('<li>y</li>')
  })

  it('still ends the paragraph after a folded heading', () => {
    expect(carveToHtml('1. - a\n     - y\n      1. # h\nz\n')).toContain('<p>z</p>')
  })
})
