import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

// markup-carve/carve#2383: a row's cells are cut before inline parsing, and
// `\|` is the only pipe the cut leaves in place, so the writer quotes a value
// holding one and escapes it.
describe('an attribute value holding a pipe', () => {
  it('keeps its table cell', () => {
    const html = '<table><tr><td id="c" data-x="a|b">t</td><td><span data-y="p|q">u</span></td></tr></table>'
    const result = htmlToCarve(html)
    expect(result.value).toBe('|{#c data-x="a\\|b"} t | [u]{data-y="p\\|q"} |\n')
    expect(carveToCarve(result.value)).toBe(result.value)
    expect(carveToHtml(result.value)).toContain('<td id="c" data-x="a|b">t</td><td><span data-y="p|q">u</span></td>')
  })

  it('is quoted outside a table too', () => {
    const source = '{data-x="a\\|b"}\nx\n'
    expect(carveToCarve('{data-x=a|b}\nx\n')).toBe(source)
    expect(carveToHtml(source)).toBe('<p data-x="a|b">x</p>')
  })
})
