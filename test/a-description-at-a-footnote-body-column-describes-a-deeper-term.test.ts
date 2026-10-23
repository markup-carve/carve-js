import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const noteList = '<dl>\n        <dt>t</dt>\n        <dd>zq</dd>\n      </dl>'

describe('a description at a footnote body column describes a deeper term', () => {
  it.each([
    ['spaces', 'r[^1]\n\n- [^1]: x\n      :: t\n    : zq\n'],
    ['a tab before the description', 'r[^1]\n\n- [^1]: x\n      :: t\n\t: zq\n'],
    ['tabs before the term', 'r[^1]\n\n- [^1]: x\n\t\t:: t\n    : zq\n'],
    ['tabs on both lines', 'r[^1]\n\n- [^1]: x\n\t\t:: t\n\t: zq\n'],
  ])('after a list marker, with %s', (_, source) => {
    const html = carveToHtml(source)
    expect(html).toContain(noteList)
    expect(html).toContain('<ul>\n  <li></li>\n</ul>')
  })

  it.each([
    ['a tab after the quote prefix', 'r[^1]\n\n> [^1]: x\n> \t:: t\n>     : zq\n'],
    ['a space and a tab after the quote prefix', 'r[^1]\n\n> [^1]: x\n>  \t:: t\n>     : zq\n'],
  ])('in a quoted footnote, %s counts from the quote content column', (_, source) => {
    expect(carveToHtml(source)).toContain(noteList)
  })

  it('counts a tab near a quote content column from the quote in a quoted item too', () => {
    expect(carveToHtml('> - x\n> \t:: t\n>     : zq\n')).toContain('<dt>t</dt>\n        <dd>zq</dd>')
  })
})
