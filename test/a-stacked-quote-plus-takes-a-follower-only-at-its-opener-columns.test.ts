import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// CARVE-P9-067: a stacked `- > +` pulls a non-list block at column 0, the line's
// own column or the quote's column. Anywhere else the `+` is refused and reads
// like a letter at its column (markup-carve/carve#3421).
describe('a stacked quote plus on an item line', () => {
  const refused = [
    '- > +\n b\n',
    '- > +\n   b\n',
    '- > +\n    b\n',
    '- > +\n     b\n',
    '- a\n  - > +\n b\n',
    '- a\n  - > +\n   b\n',
    '- a\n  - > +\n     b\n',
    '- a\n  - > +\n      b\n',
    '- a\n  - > +\n       b\n',
    '- > +\n  - b\n',
    '- a\n  - > +\n    - b\n',
    '> - > +\n>     b\n',
  ]
  for (const source of refused) {
    it(`reads the refused plus in ${JSON.stringify(source)} like a letter`, () => {
      const letter = flat(carveToHtml(source.replace('> +', '> x')))
      expect(flat(carveToHtml(source))).toBe(letter.replace('<p>x', '<p>+'))
    })
  }

  const attached: Array<[string, string]> = [
    ['- > +\n  b\n', '<ul><li><blockquote><p>b</p></blockquote></li></ul>'],
    ['- > +\n  | c |\n', '<ul><li><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></li></ul>'],
    ['- a\n  - > +\n  b\n', '<ul><li>a<ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul>'],
    ['- a\n  - > +\n    b\n', '<ul><li>a<ul><li><blockquote><p>b</p></blockquote></li></ul></li></ul>'],
    ['- a\n  - > +\n    | c |\n', '<ul><li>a<ul><li><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></li></ul></li></ul>'],
    ['1. > +\n   b\n', '<ol><li><blockquote><p>b</p></blockquote></li></ol>'],
    ['> - > +\n>   | c |\n', '<blockquote><ul><li><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></li></ul></blockquote>'],
  ]
  for (const [source, html] of attached) {
    it(`attaches the follower of ${JSON.stringify(source)} to the quote`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }
})
