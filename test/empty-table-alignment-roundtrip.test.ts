import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve, markdownToCarve } from '../src/index.js'

describe('empty table cell alignment after the span ruling', () => {
  it('omits span-shaped markers on empty body cells', () => {
    const html = '<table><tr><td style="text-align:left"></td><td style="vertical-align:top"></td></tr></table>'
    const source = htmlToCarve(html, { mode: 'semantic' }).value
    expect(source).toBe('| | |\n')
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(source)).not.toMatch(/colspan|rowspan/)
  })

  it('keeps a left column default through a delimiter row', () => {
    const html = '<table><tr><th style="text-align:left"></th></tr><tr><td style="text-align:left">a</td></tr></table>'
    const source = htmlToCarve(html, { mode: 'semantic' }).value
    expect(source).toBe('| |\n|:---|\n| a |\n')
    expect(carveToCarve(source)).toBe(source)
    expect(carveToHtml(source)).toContain('<td style="text-align: left;">a</td>')
  })

  it('reports an empty top header whose default has no delimiter spelling', () => {
    const html = '<table><tr><th style="vertical-align:top"></th></tr><tr><td style="vertical-align:top">a</td></tr></table>'
    const result = htmlToCarve(html, { mode: 'semantic' })
    expect(result.value).not.toContain('|^ ')
    expect(result.report.diagnostics.map(item => item.code)).toContain('table-degraded')
  })

  it('escapes lone span glyphs and keeps a Markdown empty left header', () => {
    expect(htmlToCarve('<table><tr><td>&lt;</td><td>^</td></tr></table>').value).toBe('| \\< | \\^ |\n')
    const source = markdownToCarve('| | x |\n| :--- | --- |\n| a | b |')
    expect(source).toBe('| | x |\n|:---|---|\n| a | b |')
    expect(carveToCarve(source)).toBe(source + '\n')
  })
})
