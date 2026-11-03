import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// A stacked opener ending in a quote `+` pulls nothing at document column 0: the
// `+` stays a letter, also when a host quote opens the line (markup-carve/carve#4409).
describe('a stacked quote plus inside a host quote', () => {
  const cases: Array<[string, string]> = [
    ['> - > +\nb\n', "<blockquote><ul><li><blockquote></blockquote></li></ul></blockquote><p>b</p>"],
    ['> 1. > +\nb\n', "<blockquote><ol><li><blockquote></blockquote></li></ol></blockquote><p>b</p>"],
    ['> > - > +\nb\n', "<blockquote><blockquote><ul><li><blockquote></blockquote></li></ul></blockquote></blockquote><p>b</p>"],
    ['> - > > +\nb\n', "<blockquote><ul><li><blockquote><blockquote></blockquote></blockquote></li></ul></blockquote><p>b</p>"],
    ['> a\n>\n> - > +\nb\n', "<blockquote><p>a</p><ul><li><blockquote></blockquote></li></ul></blockquote><p>b</p>"],
    ['> - > +\nb\n> - > +\nc\n', "<blockquote><ul><li><blockquote></blockquote></li></ul></blockquote><p>b</p><blockquote><ul><li><blockquote></blockquote></li></ul></blockquote><p>c</p>"],
    ['> a\n> > - > +\nb\n', "<blockquote><p>a</p><blockquote><ul><li><blockquote></blockquote></li></ul></blockquote></blockquote><p>b</p>"],
    // `> c` is a lazy line of the paragraph, as in the `> > b` twin.
    ['> a\n> > - > +\nb\n> c\n', "<blockquote><p>a</p><blockquote><ul><li><blockquote></blockquote></li></ul></blockquote></blockquote><p>b</p><blockquote><p>c</p></blockquote>"],
    ['> - > +\n| c |\n', "<blockquote><ul><li><blockquote></blockquote></li></ul></blockquote><table><tbody><tr><td>c</td></tr></tbody></table>"],
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
    expect(flat(carveToHtml('> - > +\n\nb\n'))).toBe(flat("<blockquote>\n  <ul>\n    <li>\n      <blockquote>\n\n      </blockquote>\n    </li>\n  </ul>\n</blockquote>\n<p>b</p>"))
  })
})
