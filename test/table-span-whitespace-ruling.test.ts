import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

const forms = ['<', ' <', '< ', ' < ']
const verticalForms = ['^', ' ^', '^ ', ' ^ ']

describe('lone table span glyphs ignore space padding', () => {
  it.each(forms)('reads colspan form %j', (cell) => {
    const html = carveToHtml(`|a|${cell}|\n`)
    expect(html).toContain('<td colspan="2">a</td>')
  })

  it.each(verticalForms)('reads rowspan form %j', (cell) => {
    const html = carveToHtml(`|a|b|\n|^|${cell}|\n`)
    expect(html).toContain('<td rowspan="2">a</td><td rowspan="2">b</td>')
  })

  it('keeps a glyph literal after a consumed kind or attribute run', () => {
    expect(carveToHtml('|= <|\n')).toContain('<th scope="col">&lt;</th>')
    expect(carveToHtml('|{.x} <|\n')).toContain('<td class="x">&lt;</td>')
  })

  it('keeps other empty alignment cells', () => {
    expect(carveToHtml('|~ |\n')).toContain('<td style="text-align: center;"></td>')
    expect(carveToHtml('|> |\n')).toContain('<td style="text-align: right;"></td>')
    expect(carveToHtml('|~{.x} |\n')).toContain('<td class="x" style="text-align: center;"></td>')
  })

  it('writes an empty left-aligned body cell without a span glyph', () => {
    const imported = htmlToCarve('<table><tr><td>a</td><td style="text-align:left"></td></tr></table>').value
    expect(carveToHtml(imported)).not.toContain('colspan')
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('keeps a header default on an empty aligned header cell', () => {
    const imported = htmlToCarve('<table><thead><tr><th style="text-align:right"></th><th>B</th></tr></thead><tbody><tr><td>a</td><td>b</td></tr></tbody></table>').value
    expect(carveToHtml(imported)).not.toContain('colspan')
    expect(carveToHtml(imported)).toContain('<th scope="col" style="text-align: right;"></th>')
    expect(carveToCarve(imported)).toBe(imported)
  })

  it('escapes a literal lone glyph in a body cell', () => {
    const imported = htmlToCarve('<table><tr><td>a</td><td>&lt;</td></tr></table>').value
    expect(imported).toContain('\\<')
    expect(carveToHtml(imported)).not.toContain('colspan')
  })
})
