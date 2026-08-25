import { describe, expect, it } from 'vitest'
import {
  RenderLossError,
  carveToAnsiWithReport,
  carveToCarveWithReport,
  carveToHtml,
  carveToHtmlWithReport,
  carveToMarkdownWithReport,
  carveToPlainTextWithReport,
  parse,
  renderHtmlWithReport,
} from '../src/index.js'

const source = '`inline`{=latex}\n\n```=typst\nblock\n```\n'

describe('render loss reports', () => {
  it('reports every raw node the HTML target drops without changing output', () => {
    const result = carveToHtmlWithReport(source)
    expect(result.value).toBe(carveToHtml(source))
    expect(result.totalLosses).toBe(2)
    expect(result.truncated).toBe(false)
    expect(result.losses.map((loss) => [loss.code, loss.format, loss.target, loss.nodeType])).toEqual([
      ['raw-format-dropped', 'latex', 'html', 'inline'],
      ['raw-format-dropped', 'typst', 'html', 'block'],
    ])
    expect(result.losses.map((loss) => loss.pos?.startLine)).toEqual([1, 3])
  })

  it('reports the target-specific drops rather than merely scanning the AST', () => {
    const html = carveToMarkdownWithReport('`<b>`{=html}\n')
    expect(html.losses).toEqual([])
    expect(html.value).toContain('&lt;b&gt;')

    const ansi = carveToAnsiWithReport(source)
    expect(ansi.losses.map((loss) => loss.nodeType)).toEqual(['inline'])
    expect(ansi.value).toContain('[raw:typst] block')

    expect(carveToPlainTextWithReport(source).totalLosses).toBe(2)
    expect(carveToCarveWithReport(source)).toMatchObject({ totalLosses: 0, truncated: false })
  })

  it('collects a bounded complete count before strict mode refuses', () => {
    let thrown: unknown
    try {
      carveToHtmlWithReport(source, { strictLosses: true, maxRenderLosses: 1 })
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(RenderLossError)
    expect(thrown).toMatchObject({ totalLosses: 2, truncated: true })
    expect((thrown as RenderLossError).losses).toHaveLength(1)
  })

  it('supports checked rendering of an existing AST', () => {
    const result = renderHtmlWithReport(parse(source))
    expect(result.totalLosses).toBe(2)
  })

  it('does not double-report during a plain-text abbreviation probe pass', () => {
    const result = carveToPlainTextWithReport('*[HTML]: HyperText\n\nHTML `x`{=latex}\n')
    expect(result.totalLosses).toBe(1)
  })

  it('validates the report bound', () => {
    expect(() => carveToHtmlWithReport(source, { maxRenderLosses: -1 })).toThrow(RangeError)
  })
})
