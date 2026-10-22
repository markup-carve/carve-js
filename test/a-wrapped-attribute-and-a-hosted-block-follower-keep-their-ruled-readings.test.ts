import { describe, it, expect } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

const flat = (html: string): string => html.split('\n').map((line) => line.trim()).join('')

// markup-carve/carve#3421 rulings 1 and 3 (22 October), which carve-js already followed.
describe('ruled readings of carve#3421 that carve-js already gave', () => {
  it('reads a wrapped attribute whose closer sits below the column like the one-line form', () => {
    const source = '- a\n  {.c\n}\npara\n'
    expect(flat(carveToHtml(source))).toBe(flat(carveToHtml('- a\n  {.c}\npara\n')))
    expect(flat(carveToHtml(source))).toBe('<ul><li>a</li></ul><p>para</p>')
    expect(lintCarve(source).map((warning) => warning.rule)).toContain('unattached-block-attribute')
  })

  const hosted: Array<[string, string]> = [
    ['> - > +\n# h\n', '<blockquote><ul><li><blockquote><h1 id="h">h</h1></blockquote></li></ul></blockquote>'],
    ['> - > +\n| c |\n', '<blockquote><ul><li><blockquote><table><tbody><tr><td>c</td></tr></tbody></table></blockquote></li></ul></blockquote>'],
    ['> - > +\npara\n', '<blockquote><ul><li><blockquote><p>para</p></blockquote></li></ul></blockquote>'],
  ]
  for (const [source, html] of hosted) {
    it(`attaches the unprefixed column-0 block of ${JSON.stringify(source)} to the inner quote`, () => {
      expect(flat(carveToHtml(source))).toBe(html)
    })
  }
})
