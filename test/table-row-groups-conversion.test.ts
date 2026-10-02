import { describe, expect, it } from 'vitest'
import { fromAstJson, parse, renderCarveWithConversionReport, toAstJson } from '../src/index.js'

const row = (value: string) => ({
  type: 'table_row',
  cells: [{ type: 'table_cell', header: false, children: [{ type: 'text', value }] }],
})
const partition = { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 }
const document = (rowGroups: object = partition) => fromAstJson({
  type: 'document', srcByteLength: 0,
  children: [{ type: 'table', rows: [row('body'), row('total')], rowGroups }],
})

const diagnostic = {
  code: 'field-unspellable', node: 'table', field: 'rowGroups',
  message: 'The canonical Carve writer cannot preserve this explicit table row-group partition',
}

describe('table row-group conversion diagnostics', () => {
  it.each([
    ['footer', partition],
    ['leading header', { headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 0 }],
    ['multiple bodies', { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1 }, { headRows: 0, bodyRows: 1 }], footRows: 0 }],
    ['body header and row headers', { headRows: 0, bodies: [{ headRows: 1, bodyRows: 1, rowHeadColumns: 1 }], footRows: 0 }],
    ['explicit single body', { headRows: 0, bodies: [{ headRows: 0, bodyRows: 2 }], footRows: 0 }],
  ])('reports a dropped %s partition and keeps cell content', (_name, groups) => {
    const ast = document(groups)
    const before = toAstJson(ast)
    const result = renderCarveWithConversionReport(ast)
    expect(result.report).toEqual({ diagnostics: [diagnostic], totalDiagnostics: 1, truncated: false })
    const reparsed = toAstJson(parse(result.value!))
    expect(reparsed.children[0]).not.toHaveProperty('rowGroups')
    expect(reparsed.children[0]).toMatchObject({ rows: [row('body'), row('total')] })
    expect(toAstJson(ast)).toEqual(before)
  })

  it('counts a suppressed partition diagnostic', () => {
    const result = renderCarveWithConversionReport(document(), {}, 0)
    expect(result.value).toBeDefined()
    expect(result.report).toEqual({ diagnostics: [], totalDiagnostics: 1, truncated: true })
  })

  it.each(['footer-rows=1', 'header-rows=1', 'header-rows', 'header-rows=0 footer-rows=0', 'header-rows=1 footer-rows=1'])('keeps partitions reconstructed from {%s}', (attrs) => {
    const ast = parse(`{${attrs}}\n| body |\n| total |`)
    const before = toAstJson(ast)
    const result = renderCarveWithConversionReport(ast)
    expect(result.report).toEqual({ diagnostics: [], totalDiagnostics: 0, truncated: false })
    expect(toAstJson(parse(result.value!)).children).toEqual(before.children)
  })

  it.each(['0', '2', '-1', 'invalid'])('reports a partition that conflicts with footer-rows=%s', (value) => {
    const ast = document()
    ast.children[0].attrs = { keyValues: { 'footer-rows': value } }
    expect(renderCarveWithConversionReport(ast).report.diagnostics).toEqual([diagnostic])
  })

  it('does not report a partition loss for ordinary pipe tables', () => {
    const ordinary = fromAstJson({ type: 'document', srcByteLength: 0, children: [{ type: 'table', rows: [row('body'), row('total')] }] })
    expect(renderCarveWithConversionReport(ordinary).report).toEqual({ diagnostics: [], totalDiagnostics: 0, truncated: false })
  })
})
