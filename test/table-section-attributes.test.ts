import { readFileSync } from 'node:fs'
import { describe, it, expect } from 'vitest'
import { fromAstJson, toAstJson } from '../src/ast-json.js'
import { renderHtml } from '../src/render-html.js'
import { renderPlainText } from '../src/render-plain.js'
import { renderMarkdown } from '../src/render-markdown.js'
import { renderAnsi } from '../src/render-ansi.js'
import { renderCarve } from '../src/render-carve.js'
import { renderCarveWithConversionReport } from '../src/conversion-diagnostics.js'

const row = (value: string) => ({ type: 'table_row', cells: [{ type: 'table_cell', header: false, children: [{ type: 'text', value }] }] })
const document = (headRows = 1, footRows = 1) => ({ type: 'document', srcByteLength: 0, children: [{
  type: 'table', rows: [...(headRows ? [row('H')] : []), row('B'), ...(footRows ? [row('F')] : [])],
  rowGroups: { headRows, footRows, headAttrs: { id: 'head', keyValues: { onclick: 'evil()', title: '"&' } },
    footAttrs: { classes: ['foot'] }, bodies: [{ headRows: 0, bodyRows: 1, attrs: { id: 'body' } }] },
}] })

describe('table section attributes', () => {
  it('preserves attributes in AST exchange and places them on HTML sections', () => {
    const wire = document()
    const ast = fromAstJson(wire)
    expect(toAstJson(ast)).toEqual(wire)
    const html = renderHtml(ast)
    expect(html).toContain('<thead id="head" title="&quot;&amp;">')
    expect(html).toContain('<tbody id="body">')
    expect(html).toContain('<tfoot class="foot">')
    expect(html).not.toContain('onclick')
    const { report } = renderCarveWithConversionReport(ast, renderCarve)
    expect(report.diagnostics.map(d => d.field)).toEqual(expect.arrayContaining(['rowGroups.headAttrs', 'rowGroups.footAttrs', 'rowGroups.bodies[0].attrs']))
  })
  it('renders attributed empty head and foot sections', () => {
    const html = renderHtml(fromAstJson(document(0, 0)))
    expect(html).toContain('<thead id="head" title="&quot;&amp;">\n  </thead>')
    expect(html).toContain('<tfoot class="foot">\n  </tfoot>')
  })
  it('rejects malformed section attributes', () => {
    const wire = document()
    ;(wire.children[0].rowGroups as any).headAttrs = { classes: 7 }
    expect(() => fromAstJson(wire)).toThrow()
  })
  it('reports each attribute loss on text targets', () => {
    for (const render of [renderPlainText, renderMarkdown, renderAnsi]) {
      const losses: any[] = []
      render(fromAstJson(document()), { onRenderLoss: loss => losses.push(loss) })
      expect(losses.filter(loss => loss.code === 'table-section-attributes-dropped')).toHaveLength(3)
    }
  })
  it('keeps section attributes when a span meets a boundary without mutating the AST', () => {
    const wire = document()
    ;(wire.children[0].rows[1].cells[0] as any).span = 'rowspan'
    const ast = fromAstJson(wire)
    const before = toAstJson(ast)
    const html = renderHtml(ast)
    expect(html).toContain('<thead id="head"')
    expect(html).toContain('<tbody id="body">')
    expect(html).not.toContain('rowspan="2"')
    expect(toAstJson(ast)).toEqual(before)
  })

})

it('matches shared section rendering fixtures', () => {
  const fixtures = JSON.parse(readFileSync(new URL('../spec/tests/fixtures/table-section-attributes.json', import.meta.url), 'utf8'))
  for (const fixture of fixtures) {
    const ast = fromAstJson(fixture.ast)
    expect(renderHtml(ast).trimEnd(), fixture.name).toBe(fixture.html)
    expect(toAstJson(ast)).toEqual(fixture.ast)
  }
})
