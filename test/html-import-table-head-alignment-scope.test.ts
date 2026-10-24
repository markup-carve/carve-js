import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

describe('HTML import keeps header alignment in its original scope', () => {
  it('keeps cell-only markers local with a colspan', () => {
    const source = '{header-rows=1}\n|> Wide|<|~ Last|\n|a|b|c|\n'
    const html = carveToHtml(source)
    const imported = htmlToCarve(html).value
    expect(imported).toContain('{header-rows=1}')
    expect(imported).not.toContain('|---|')
    expect(carveToCarve(imported)).toBe(imported)
    expect(carveToHtml(imported)).toBe(html)
  })

  it('keeps cell-only markers local without a span', () => {
    const source = '{header-rows=1}\n|> A|~ B|\n|a|b|\n'
    const html = carveToHtml(source)
    const imported = htmlToCarve(html).value
    expect(imported).toContain('{header-rows=1}')
    expect(carveToCarve(imported)).toBe(imported)
    expect(carveToHtml(imported)).toBe(html)
  })

  it('keeps a mixed body cell alignment explicit', () => {
    const html = '<table><thead><tr><th style="text-align: right">H</th></tr></thead><tbody><tr><td style="text-align: right">a</td></tr><tr><td>b</td></tr></tbody></table>'
    const imported = htmlToCarve(html).value
    expect(imported).toContain('{header-rows=1}')
    expect(imported).toContain('|> a |')
    expect(imported).toContain('| b |')
    const rendered = carveToHtml(imported)
    expect(rendered).toContain('<td style="text-align: right;">a</td>')
    expect(rendered).toContain('<td>b</td>')
  })

  it('keeps inherited defaults compact when every body cell carries them', () => {
    const source = '|=> A|=~ B|\n|a|b|\n'
    const html = carveToHtml(source)
    const imported = htmlToCarve(html).value
    expect(imported).not.toContain('{header-rows=1}')
    expect(carveToHtml(imported)).toBe(html)
  })

  it('puts generated delimiter alignment in colons and reaches a fixed point', () => {
    const source = '|=> Wide|<|=~ Last|\n|a|b|c|\n'
    const html = carveToHtml(source)
    const imported = htmlToCarve(html).value
    expect(imported).toContain('|---:|---|:---:|')
    expect(carveToCarve(imported)).toBe(imported)
    expect(carveToHtml(imported)).toBe(html)
  })

  it('does not seed a column from a tbody header after thead', () => {
    const html = '<table><thead><tr><th style="text-align:right">H</th></tr></thead>'
      + '<tbody><tr><th style="text-align:center">X</th></tr>'
      + '<tr><td style="text-align:center">a</td></tr></tbody></table>'
    const imported = htmlToCarve(html).value
    const rendered = carveToHtml(imported)
    expect(rendered).toContain('<th scope="col" style="text-align: right;">H</th>')
    expect(rendered).toContain('<th scope="col" style="text-align: center;">X</th>')
    expect(rendered).toContain('<td style="text-align: center;">a</td>')
  })

  it('keeps authored header markers as column defaults under header-rows', () => {
    const source = '{header-rows=1}\n|=> A|=~ B|\n|a|b|\n'
    const written = carveToCarve(source)
    expect(written).toContain('|=> A |=~ B |')
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  })

  it('reports a carried delimiter that cannot preserve local head alignment', () => {
    const html = '<table data-carve-col-widths="3"><thead><tr><th style="text-align:right">H</th></tr></thead><tbody><tr><td>b</td></tr></tbody></table>'
    const result = htmlToCarve(html)
    expect(result.value).toContain('{header-rows=1}')
    expect(result.value).not.toContain('|---:|')
    expect(result.report.diagnostics.some(item => item.message.includes('Dropped col-widths carrier'))).toBe(true)
    expect(carveToHtml(result.value)).toContain('<td>b</td>')
  })
})
