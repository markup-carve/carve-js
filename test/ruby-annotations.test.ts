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

  it('compares escape candidates with flattened ruby', () => {
    const withRuby: Document = {
      type: 'document',
      children: [{ type: 'paragraph', children: [
        { type: 'ruby', pairs: [{ base: [{ type: 'text', value: 'x' }], annotation: [{ type: 'text', value: 'y' }] }] },
        { type: 'text', value: ' 1. x' },
      ] }],
    }
    expect(renderCarveWithReport(withRuby).value).toBe('x(y) 1. x\n')
  })

  it('round-trips through encoded AST JSON', () => {
    expect(toAstJson(fromAstJson(toAstJson(document)))).toEqual(toAstJson(document))
    const wire = structuredClone(toAstJson(document)) as unknown as { children: Array<{ children: Array<{ pairs: Array<Record<string, unknown>> }> }> }
    wire.children[0]!.children[0]!.pairs[0]!.extra = true
    expect(() => fromAstJson(wire as never)).toThrow(/carries "extra"/)
    const emptyPairs = structuredClone(toAstJson(document)) as unknown as { children: Array<{ children: Array<{ pairs: unknown[] }> }> }
    emptyPairs.children[0]!.children[0]!.pairs = []
    expect(() => fromAstJson(emptyPairs as never)).toThrow(/pairs.*at least one/)
    const emptyBase = structuredClone(toAstJson(document)) as unknown as { children: Array<{ children: Array<{ pairs: Array<{ base: unknown[] }> }> }> }
    emptyBase.children[0]!.children[0]!.pairs[0]!.base = []
    expect(() => fromAstJson(emptyBase as never)).toThrow(/base.*at least one/)
    const blockBase = structuredClone(toAstJson(document)) as unknown as { children: Array<{ children: Array<{ pairs: Array<{ base: unknown[] }> }> }> }
    blockBase.children[0]!.children[0]!.pairs[0]!.base = [{ type: 'paragraph', children: [] }]
    expect(() => fromAstJson(blockBase as never)).toThrow(/paragraph.*admits only/)
    const blockAnnotation = structuredClone(toAstJson(document)) as unknown as { children: Array<{ children: Array<{ pairs: Array<{ annotation: unknown[] }> }> }> }
    blockAnnotation.children[0]!.children[0]!.pairs[0]!.annotation = [{ type: 'heading', level: 1, children: [] }]
    expect(() => fromAstJson(blockAnnotation as never)).toThrow(/heading.*admits only/)
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

  it('keeps an empty annotation and reads nested ruby recursively', () => {
    const empty = htmlToAst('<p><ruby>x<rt></rt></ruby></p>')
    expect(empty.value.children[0]).toMatchObject({
      children: [{ type: 'ruby', pairs: [{ base: [{ value: 'x' }], annotation: [] }] }],
    })

    const nested = htmlToAst('<p><ruby><ruby>B<rt>a</rt></ruby><rt>outer</rt></ruby></p>')
    expect(nested.value.children[0]).toMatchObject({
      children: [{
        type: 'ruby',
        pairs: [{ base: [{ type: 'ruby', pairs: [{ base: [{ value: 'B' }], annotation: [{ value: 'a' }] }] }], annotation: [{ value: 'outer' }] }],
      }],
    })
  })

  it('applies ordinary URL policy inside annotations', () => {
    const result = htmlToAst('<p><ruby>x<rt><a href="javascript:alert(1)">note</a></rt></ruby></p>')
    expect(renderHtml(result.value)).not.toContain('javascript:')
  })

  it('keeps unpaired content and reports its declared fidelity', () => {
    const base = htmlToAst('<p><ruby>base</ruby></p>')
    expect(base.value.children[0]).toMatchObject({ children: [{ type: 'text', value: 'base' }] })
    expect(base.report.diagnostics).toMatchObject([{ code: 'element-unwrapped', fidelity: 'normalized' }])

    const annotation = htmlToAst('<p><ruby><rt>note</rt></ruby></p>')
    expect(annotation.value.children[0]).toMatchObject({ children: [{ type: 'text', value: '(note)' }] })
    expect(annotation.report.diagnostics).toMatchObject([{ code: 'element-unwrapped', fidelity: 'degraded' }])

    const attributed = htmlToAst('<p><ruby id="r" lang="ja">base</ruby></p>')
    expect(attributed.report.diagnostics.map((row) => row.code)).toEqual([
      'element-unwrapped', 'attribute-dropped', 'attribute-dropped',
    ])
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

  it('keeps split-run attributes on one span around the complete output', () => {
    const result = htmlToAst('<p><ruby id="r">a<rt>x</rt><rt>y</rt>b<rt>z</rt></ruby></p>')
    expect(result.value.children[0]).toMatchObject({
      children: [{
        type: 'span',
        attrs: { id: 'r' },
        children: [
          { type: 'ruby', pairs: [{ base: [{ value: 'a' }], annotation: [{ value: 'x' }] }] },
          { type: 'text', value: '(' },
          { type: 'text', value: 'y' },
          { type: 'text', value: ')' },
          { type: 'ruby', pairs: [{ base: [{ value: 'b' }], annotation: [{ value: 'z' }] }] },
        ],
      }],
    })
    expect(renderHtml(result.value).match(/id="r"/g)).toHaveLength(1)
  })

  it('ignores comments while deciding whether a base exists', () => {
    const result = htmlToAst('<p><ruby><!-- hidden --><rt>x</rt></ruby></p>')
    expect(result.value.children[0]).toMatchObject({ children: [{ type: 'text', value: '(x)' }] })
    expect(result.report.diagnostics).toMatchObject([{ code: 'element-unwrapped', fidelity: 'degraded' }])
  })

  it('numbers footnotes inside both sides', () => {
    const withNotes = structuredClone(document)
    const ruby = (withNotes.children[0] as { children: Array<{ pairs: Array<{ base: unknown[]; annotation: unknown[] }> }> }).children[0]!
    ruby.pairs[0]!.base.push({ type: 'footnote_ref', id: 'base' })
    ruby.pairs[0]!.annotation.push({ type: 'footnote_ref', id: 'note' })
    withNotes.footnoteDefs = {
      base: [{ type: 'paragraph', children: [{ type: 'text', value: 'Base note' }] }],
      note: [{ type: 'paragraph', children: [{ type: 'text', value: 'Annotation note' }] }],
    }
    const html = renderHtml(withNotes)
    expect(html).toContain('id="fnref1"')
    expect(html).toContain('id="fnref2"')
  })

  it('declares source flattening only on the HTML-to-Carve exit', () => {
    expect(htmlToAst('<p><ruby>x<rt>y</rt></ruby></p>').report.diagnostics).toEqual([])
    expect(htmlToCarve('<p><ruby>x<rt>y</rt></ruby></p>')).toMatchObject({
      value: 'x(y)\n',
      report: { diagnostics: [{ code: 'structure-unspellable' }] },
    })
  })

  it('escapes generated fallback boundaries through the ordinary writer', () => {
    const collision: Document = {
      type: 'document',
      children: [{
        type: 'paragraph',
        children: [{
          type: 'ruby',
          pairs: [
            { base: [{ type: 'text', value: '[x]' }], annotation: [{ type: 'text', value: 'ann' }] },
            { base: [{ type: 'text', value: 'mark' }], annotation: [{ type: 'text', value: 'c' }] },
          ],
        }],
      }],
    }
    const rendered = renderCarveWithReport(collision).value
    expect(rendered).not.toContain('[x](ann)')
    expect(rendered).not.toContain('(c)')
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
