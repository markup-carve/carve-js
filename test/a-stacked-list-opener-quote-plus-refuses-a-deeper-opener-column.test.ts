import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')
const refusals = (source: string): number =>
  lintCarve(source).filter((warning) => warning.rule === 'continuation-marker-refused').length

// CARVE-P9-067, ruled on markup-carve/carve#3421: a stacked first-block `+` takes a
// follower at column 0, at the opener line's own column, or at the column of the
// innermost quote, which owns the `+`. An intervening opener's column is refused, so
// the `+` reads like a letter and the follower folds in.
describe('a stacked quote plus behind more than one opener', () => {
  const refused = [
    '- - > +\n  b\n',
    '- - > +\n b\n',
    '- 1. > +\n  b\n',
    '- a\n  - - > +\n    b\n',
    '- a\n  - - > +\n   b\n',
    '- - > +\n  # h\n',
    '- > > +\n  b\n',
    '- > > +\n  # h\n',
    '- a\n  - > > +\n    b\n',
    '> - - > +\n>   b\n',
    '> - > > +\n>   b\n',
    '> - > > +\n>   | c |\n',
  ]
  for (const source of refused) {
    it(`reads the refused plus in ${JSON.stringify(source)} like a letter`, () => {
      const letter = flat(carveToHtml(source.replace('> +', '> x')))
      expect(flat(carveToHtml(source))).toBe(letter.replace('<p>x', '<p>+'))
      expect(refusals(source)).toBe(1)
    })
  }

  it('refuses a quote follower at the outer quote column', () => {
    const source = '- > > +\n  > q\n'
    expect(flat(carveToHtml(source))).toBe('<ul><li><blockquote><blockquote><p>+q</p></blockquote></blockquote></li></ul>')
    expect(refusals(source)).toBe(1)
  })

  const attached: Array<[string, string]> = [
    ['- - > +\nb\n', '<ul><li><ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul>'],
    ['- > +\n  b\n', '<ul><li><blockquote><p>b</p></blockquote></li></ul>'],
    ['- - > +\n    b\n', '<ul><li><ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul>'],
    ['- - > +\n    # h\n', '<ul><li><ul><li><blockquote><h1 id="h">h</h1></blockquote></li></ul></li></ul>'],
    ['- 1. > +\n     b\n', '<ul><li><ol><li><blockquote><p>b</p></blockquote></li></ol></li></ul>'],
    ['- a\n  - - > +\n      b\n', '<ul><li>a<ul><li><ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul></li></ul>'],
    ['- a\n  - - > +\n  b\n', '<ul><li>a<ul><li><ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul></li></ul>'],
    ['- > > +\n    b\n', '<ul><li><blockquote><blockquote><p>b</p></blockquote></blockquote></li></ul>'],
    ['- > > +\n> q\n', '<ul><li><blockquote><blockquote><blockquote><p>q</p></blockquote></blockquote></blockquote></li></ul>'],
    ['> - - > +\n>     b\n', '<blockquote><ul><li><ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul></blockquote>'],
    ['> - > > +\n>     b\n', '<blockquote><ul><li><blockquote><blockquote><p>b</p></blockquote></blockquote></li></ul></blockquote>'],
  ]
  for (const [source, html] of attached) {
    it(`attaches the follower of ${JSON.stringify(source)} to the quote`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
      expect(refusals(source)).toBe(0)
    })
  }

  // An indented `>` is no host quote prefix (`> a` / `  > b`), so the follower is lazy text.
  for (const [source, html] of [
    ['> - > +\n  > b\n', '<blockquote><ul><li><blockquote><p>+b</p></blockquote></li></ul></blockquote>'],
    ['> - - > +\n    > b\n', '<blockquote><ul><li><ul><li><blockquote><p>+b</p></blockquote></li></ul></li></ul></blockquote>'],
  ]) {
    it(`reads the indented quote marker in ${JSON.stringify(source)} as a quote`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }

  it('leaves a stacked list plus without a quote as it was', () => {
    expect(flat(carveToHtml('- - +\n  b\n'))).toBe('<ul><li><ul><li></li></ul>b</li></ul>')
  })
})
