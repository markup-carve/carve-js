import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// A stacked opener ending in a quote `+` pulls nothing at document column 0: the
// `+` stays a letter, also when a host quote opens the line (markup-carve/carve#4409).
describe('a stacked quote plus inside a host quote', () => {
  const cases: Array<[string, string]> = [
    ['> - > +\nb\n', '<blockquote><ul><li><blockquote><p>+b</p></blockquote></li></ul></blockquote>'],
    ['> 1. > +\nb\n', '<blockquote><ol><li><blockquote><p>+b</p></blockquote></li></ol></blockquote>'],
    ['> > - > +\nb\n', '<blockquote><blockquote><ul><li><blockquote><p>+b</p></blockquote></li></ul></blockquote></blockquote>'],
    ['> - > > +\nb\n', '<blockquote><ul><li><blockquote><blockquote><p>+b</p></blockquote></blockquote></li></ul></blockquote>'],
    ['> a\n>\n> - > +\nb\n', '<blockquote><p>a</p><ul><li><blockquote><p>+b</p></blockquote></li></ul></blockquote>'],
    ['> - > +\nb\n> - > +\nc\n', '<blockquote><ul><li><blockquote><p>+b</p></blockquote></li><li><blockquote><p>+c</p></blockquote></li></ul></blockquote>'],
    ['> a\n> > - > +\nb\n', '<blockquote><p>a</p><blockquote><ul><li><blockquote><p>+b</p></blockquote></li></ul></blockquote></blockquote>'],
    // `> c` is a lazy line of the paragraph, as in the `> > b` twin.
    ['> a\n> > - > +\nb\n> c\n', '<blockquote><p>a</p><blockquote><ul><li><blockquote><p>+bc</p></blockquote></li></ul></blockquote></blockquote>'],
    ['> - > +\n| c |\n', '<blockquote><ul><li><blockquote><p>+</p></blockquote></li></ul></blockquote><table><tbody><tr><td>c</td></tr></tbody></table>'],
  ]
  for (const [source, html] of cases) {
    it(`refuses the column-0 follower of ${JSON.stringify(source)}`, () => {
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
