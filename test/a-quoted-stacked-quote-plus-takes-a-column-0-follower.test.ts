import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// CARVE-P9-067: a stacked opener ending in a quote `+` pulls a non-list block at
// document column 0 into its innermost quote, also when a host quote opens the line.
describe('a stacked quote plus inside a host quote', () => {
  const cases: Array<[string, string]> = [
    ['> - > +\nb\n', '<blockquote><ul><li><blockquote><p>b</p></blockquote></li></ul></blockquote>'],
    ['> 1. > +\nb\n', '<blockquote><ol><li><blockquote><p>b</p></blockquote></li></ol></blockquote>'],
    ['> > - > +\nb\n', '<blockquote><blockquote><ul><li><blockquote><p>b</p></blockquote></li></ul></blockquote></blockquote>'],
    ['> - > > +\nb\n', '<blockquote><ul><li><blockquote><blockquote><p>b</p></blockquote></blockquote></li></ul></blockquote>'],
    ['> a\n>\n> - > +\nb\n', '<blockquote><p>a</p><ul><li><blockquote><p>b</p></blockquote></li></ul></blockquote>'],
    ['> - > +\nb\n> - > +\nc\n', '<blockquote><ul><li><blockquote><p>b</p></blockquote></li><li><blockquote><p>c</p></blockquote></li></ul></blockquote>'],
    ['> - > +\n| c |\n', '<blockquote><ul><li><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></li></ul></blockquote>'],
  ]
  for (const [source, html] of cases) {
    it(`attaches the column-0 follower of ${JSON.stringify(source)}`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }

  it('leaves a follower alone when the opener line is lazy paragraph text', () => {
    const before = flat(carveToHtml('> a\n> - > x\n| c |\n'))
    expect(flat(carveToHtml('> a\n> - > +\n| c |\n'))).toBe(before.replace('- &gt; x', '- &gt; +'))
  })

  it('leaves a blank-separated line outside', () => {
    expect(flat(carveToHtml('> - > +\n\nb\n'))).toBe('<blockquote><ul><li><blockquote><p>+</p></blockquote></li></ul></blockquote><p>b</p>')
  })
})
