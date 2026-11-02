import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// Below a description paragraph, a marker at the quote's column misses the
// description body, so it closes the body and opens a list in the quote,
// also when the quote sits in an item (carve#4231, carve#4860).
describe('a marker a quote owns below a description closes it (carve#4231, carve#4860)', () => {
  for (const [host, pad] of [['', ''], ['- ', '  '], ['1. ', '   '], ['- - ', '    ']] as const) {
    for (const marker of ['- z', '1. z', '* z', 'a) z']) {
      it(`${JSON.stringify(host)} host, ${marker}`, () => {
        const html = carveToHtml(`${host}> :: t\n${pad}> : d\n${pad}> ${marker}\n`)
        expect(html).toContain('<dd>d</dd>')
        expect(html).toContain('<li>z</li>')
      })
    }
  }

  it('renders the reported shape', () => {
    const html = carveToHtml('- > :: t\n  > : d\n  > - z\n')
    expect(html).toContain('<dd>d</dd>')
    expect(html).toContain('<li>z</li>')
  })

  it('keeps a sublist an item owns', () => {
    expect(carveToHtml('- :: t\n  : d\n  - z\n')).toContain('<ul>\n      <li>z</li>')
  })
})
