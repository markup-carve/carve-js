import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')
const refusals = (source: string): number =>
  lintCarve(source).filter((warning) => warning.rule === 'continuation-marker-refused').length

// CARVE-P9-067, ruled on markup-carve/carve#3421 (item 5): a stacked first-block
// `+` takes a follower at column 0 or the opener line's own column, plus the
// column of a quote the line's first marker opens. An inner item's column is
// not one of them, so the `+` reads like a letter and the follower folds in.
describe('a stacked quote plus behind more than one list marker', () => {
  const refused = [
    '- - > +\n  b\n',
    '- - > +\n b\n',
    '- - > +\n    b\n',
    '- 1. > +\n  b\n',
    '- a\n  - - > +\n    b\n',
    '- a\n  - - > +\n   b\n',
    '- - > +\n  # h\n',
  ]
  for (const source of refused) {
    it(`reads the refused plus in ${JSON.stringify(source)} like a letter`, () => {
      const letter = flat(carveToHtml(source.replace('> +', '> x')))
      expect(flat(carveToHtml(source))).toBe(letter.replace('<p>x', '<p>+'))
      expect(refusals(source)).toBe(1)
    })
  }

  it('reads a quote follower at the inner quote column like a letter', () => {
    const source = '- - > +\n    > q\n'
    const letter = flat(carveToHtml(source.replace('> +', '> x')))
    expect(flat(carveToHtml(source))).toBe(letter.replace('<p>x', '<p>+'))
  })

  const attached: Array<[string, string]> = [
    ['- - > +\nb\n', '<ul><li><ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul>'],
    ['- > > +\n  b\n', '<ul><li><blockquote><blockquote><p>b</p></blockquote></blockquote></li></ul>'],
    ['- a\n  - - > +\n  b\n', '<ul><li>a<ul><li><ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul></li></ul>'],
  ]
  for (const [source, html] of attached) {
    it(`attaches the follower of ${JSON.stringify(source)} to the quote`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
      expect(refusals(source)).toBe(0)
    })
  }

  it('leaves a stacked list plus without a quote as it was', () => {
    expect(flat(carveToHtml('- - +\n  b\n'))).toBe('<ul><li><ul><li></li></ul>b</li></ul>')
  })
})
