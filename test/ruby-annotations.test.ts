import { describe, expect, it } from 'vitest'
import {
  applyProfile,
  fromAstJson,
  htmlToAst,
  htmlToCarve,
  Profile,
  renderAnsiWithReport,
  renderCarveWithReport,
  renderHtml,
  renderMarkdownWithReport,
  renderPlainTextWithReport,
  toAstJson,
  type Document,
} from '../src/index.js'

const document: Document = {
  type: 'document',
  children: [{
    type: 'paragraph',
    children: [{
      type: 'ruby',
      attrs: { id: 'reading' },
      pairs: [
        { base: [{ type: 'text', value: '漢' }], annotation: [{ type: 'text', value: 'かん' }] },
        { base: [{ type: 'text', value: '字' }], annotation: [{ type: 'text', value: 'じ' }] },
      ],
    }],
  }],
}

describe('ruby annotations', () => {
  it('renders native HTML and Markdown without loss', () => {
    const html = '<p><ruby id="reading">漢<rp>(</rp><rt>かん</rt><rp>)</rp>字<rp>(</rp><rt>じ</rt><rp>)</rp></ruby></p>'
    expect(renderHtml(document)).toBe(html)
    expect(renderMarkdownWithReport(document)).toMatchObject({
      value: '<ruby id="reading">漢<rp>(</rp><rt>かん</rt><rp>)</rp>字<rp>(</rp><rt>じ</rt><rp>)</rp></ruby>\n',
      totalLosses: 0,
    })
  })

  it('uses a readable checked fallback for plain, ANSI, and Carve', () => {
    expect(renderPlainTextWithReport(document)).toMatchObject({ value: '漢(かん)字(じ)\n', totalLosses: 1 })
    expect(renderAnsiWithReport(document).value).toContain('漢(かん)字(じ)')
    const carve = renderCarveWithReport(document)
    expect(carve.value).toBe('[漢(かん)字(じ)]{#reading}\n')
    expect(carve.losses).toMatchObject([{ code: 'ruby-flattened', target: 'carve', nodeType: 'inline' }])
    expect(carve.losses[0]).not.toHaveProperty('format')
  })

  it('round-trips through encoded AST JSON', () => {
    expect(toAstJson(fromAstJson(toAstJson(document)))).toEqual(toAstJson(document))
    const wire = toAstJson(document) as unknown as { children: Array<{ children: Array<{ pairs: Array<Record<string, unknown>> }> }> }
    wire.children[0]!.children[0]!.pairs[0]!.extra = true
    expect(() => fromAstJson(wire as never)).toThrow(/carries "extra"/)
  })

  it('imports conventional rp and reports custom fallback only', () => {
    const conventional = htmlToAst('<p><ruby>漢<rp>（</rp><rt>かん</rt><rp>）</rp></ruby></p>')
    expect(conventional.value.children[0]).toMatchObject({
      children: [{ type: 'ruby', pairs: [{ base: [{ value: '漢' }], annotation: [{ value: 'かん' }] }] }],
    })
    expect(conventional.report.diagnostics).toEqual([])

    const custom = htmlToAst('<p><ruby>漢<rp>[</rp><rt>かん</rt><rp>]</rp></ruby></p>')
    expect(custom.report.diagnostics.map((row) => row.code)).toEqual(['element-dropped', 'element-dropped'])
    expect(custom.report.diagnostics.map((row) => row.fidelity)).toEqual(['degraded', 'degraded'])
  })

  it('keeps unpaired content and reports its declared fidelity', () => {
    const base = htmlToAst('<p><ruby>base</ruby></p>')
    expect(base.value.children[0]).toMatchObject({ children: [{ type: 'text', value: 'base' }] })
    expect(base.report.diagnostics).toMatchObject([{ code: 'element-unwrapped', fidelity: 'normalized' }])

    const annotation = htmlToAst('<p><ruby><rt>note</rt></ruby></p>')
    expect(annotation.value.children[0]).toMatchObject({ children: [{ type: 'text', value: '(note)' }] })
    expect(annotation.report.diagnostics).toMatchObject([{ code: 'element-unwrapped', fidelity: 'degraded' }])
  })

  it('preserves obsolete component content and declares its degradation', () => {
    const result = htmlToAst('<p><ruby><rb>漢</rb><rt>かん</rt><rtc><rt>kan</rt></rtc></ruby></p>')
    expect(result.value.children[0]).toMatchObject({
      children: [
        { type: 'ruby', pairs: [{ base: [{ value: '漢' }], annotation: [{ value: 'かん' }] }] },
        { type: 'text', value: '(kan)' },
      ],
    })
    expect(result.report.diagnostics.map((row) => row.code)).toContain('element-unwrapped')
  })

  it('follows segmentation whitespace and flattens an additional annotation', () => {
    const result = htmlToAst('<p><ruby>A<rt>a</rt> \n <rt>extra</rt> B<rt>b</rt></ruby></p>')
    expect(result.value.children[0]).toMatchObject({
      children: [
        { type: 'ruby', pairs: [{ base: [{ value: 'A' }], annotation: [{ value: 'a' }] }] },
        { type: 'text', value: '(extra)' },
        { type: 'ruby', pairs: [{ base: [{ value: ' B' }], annotation: [{ value: 'b' }] }] },
      ],
    })
    expect(result.report.diagnostics.map((row) => row.code)).toEqual(['element-unwrapped'])
  })

  it('declares source flattening only on the HTML-to-Carve exit', () => {
    expect(htmlToAst('<p><ruby>x<rt>y</rt></ruby></p>').report.diagnostics).toEqual([])
    expect(htmlToCarve('<p><ruby>x<rt>y</rt></ruby></p>')).toMatchObject({
      value: 'x(y)\n',
      report: { diagnostics: [{ code: 'structure-unspellable' }] },
    })
  })

  it('uses the fallback for profile to_text', () => {
    const profile = new Profile().denyInline(['ruby']).onDisallowed('to_text')
    expect(applyProfile(structuredClone(document), profile).doc.children[0]).toMatchObject({
      children: [{ type: 'text', value: '漢(かん)字(じ)' }],
    })
    expect(applyProfile(structuredClone(document), new Profile().denyInline(['ruby']).onDisallowed('strip')).doc.children).toEqual([])
    expect(() => applyProfile(structuredClone(document), new Profile().denyInline(['ruby']).onDisallowed('error'))).toThrow(/ruby/)
  })
})
