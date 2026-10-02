import { describe, expect, it } from 'vitest'
import { fromAstJson, parse, renderCarveWithConversionReport, renderHtml, toAstJson } from '../src/index.js'

const row = (value: string) => ({ type: 'table_row', cells: [
  { type: 'table_cell', header: false, children: [{ type: 'text', value }] },
  { type: 'table_cell', header: false, children: [{ type: 'text', value: 'other' }] },
] })
const document = (fields: object) => fromAstJson({ type: 'document', srcByteLength: 0, children: [{ type: 'table', rows: [row('body'), row('total')], ...fields }] })

const columnsDiagnostic = {
  code: 'field-unspellable', node: 'table', field: 'columns',
  message: 'The canonical Carve writer cannot preserve these table columns with the retained attributes',
}

describe('table source metadata', () => {
  it('renders decimal percentages without floating-point noise', () => {
    const ast = parse('{widths=33.3,0.7,7}\n| a | b | c |\n')
    const html = renderHtml(ast)
    expect(html).toContain('width: 33.3%;')
    expect(html).toContain('width: 0.7%;')
    expect(html).toContain('width: 7%;')
    expect(renderCarveWithConversionReport(ast).report.diagnostics).toEqual([])
  })

  it.each([
    [{ align: 'left' }, { align: 'right' }],
    [{ valign: 'top' }, { valign: 'bottom' }],
    [{ width: 0.4 }, { width: 0.6 }],
    [{ width: 0.013 }, { width: 1 / 3 }],
    [{ width: 1e-20 }, { width: Number.MIN_VALUE }],
    [{ align: 'center', valign: 'middle', width: 0.25 }, { align: 'right', valign: 'bottom', width: 0.75 }],
    [{}, {}],
    [{ align: 'right' }, {}],
    [{}, { width: 0.6 }],
  ])('preserves imported columns %j', (...columns) => {
    const ast = document({ columns })
    const before = toAstJson(ast)
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics).toEqual([])
    expect(toAstJson(parse(result.value!)).children[0]).toMatchObject({ columns })
    expect(renderHtml(parse(result.value!))).toBe(renderHtml(ast))
    expect(toAstJson(ast)).toEqual(before)
  })

  it.each([
    { aligns: 'right,left' },
    { aligns: 'invalid,right' },
    { aligns: 'left,right,center' },
    { widths: '20,80' },
    { widths: 'invalid,60' },
    { valigns: 'bottom,top' },
  ])('diagnoses conflicting column attributes %j', (keyValues) => {
    const ast = document({ columns: [{ align: 'left', valign: 'top', width: 0.4 }, { align: 'right', valign: 'bottom', width: 0.6 }], attrs: { keyValues } })
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics).toEqual([columnsDiagnostic])
    expect(toAstJson(parse(result.value!)).children[0]).toMatchObject({ attrs: { keyValues } })
  })

  it('preserves matching authored metadata without new diagnostics', () => {
    const source = '{#table widths=40,60 aligns=left,right valigns=top,bottom footer-rows=1}\n| body | other |\n| total | other |\n'
    const ast = parse(source)
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics).toEqual([])
    expect(result.value).toBe(source)
  })

  it('combines caption, attributes, spans, row groups, and column metadata', () => {
    const ast = parse('{#table .wide title="A table"}\n|= H | < |\n| B | C |\n| Total | Sum |\n^ A /caption/\n', { positions: false })
    const table = ast.children[0]
    if (table.type !== 'table') throw new Error('Expected a table')
    table.rowGroups = { headRows: 1, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 }
    table.columns = [{ width: 0.4, align: 'left', valign: 'top' }, { width: 0.6, align: 'right', valign: 'bottom' }]
    const before = toAstJson(ast)
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics).toEqual([])
    const reparsed = parse(result.value!, { positions: false })
    expect(toAstJson(reparsed).children[0]).toMatchObject({ rowGroups: table.rowGroups, columns: table.columns, caption: table.caption })
    expect(renderHtml(reparsed)).toBe(renderHtml(ast))
    expect(toAstJson(ast)).toEqual(before)
    expect(renderCarveWithConversionReport(reparsed).value).toBe(result.value)
  })

  it('keeps a footer and columns while separately diagnosing section attributes and block cells', () => {
    const ast = document({ columns: [{ width: 0.4 }, { width: 0.6 }], rowGroups: { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1, attrs: { id: 'body' } }], footRows: 1, footAttrs: { classes: ['total'] } } })
    const table = ast.children[0]
    if (table.type !== 'table') throw new Error('Expected a table')
    delete table.rows[0].cells[0].children
    table.rows[0].cells[0].blocks = [{ type: 'paragraph', children: [{ type: 'text', value: 'body' }] }]
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics.map(({ field }) => field)).toEqual(['rowGroups.footAttrs', 'rowGroups.bodies[0].attrs', 'blocks'])
    expect(toAstJson(parse(result.value!)).children[0]).toMatchObject({ columns: table.columns, rowGroups: { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1 }], footRows: 1 } })
  })
})


describe('table body source metadata', () => {
  it.each([
    { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1 }, { headRows: 0, bodyRows: 1 }], footRows: 0 },
    { headRows: 0, bodies: [{ headRows: 1, bodyRows: 1, rowHeadColumns: 1 }], footRows: 0 },
    { headRows: 0, bodies: [{ headRows: 0, bodyRows: 0 }, { headRows: 1, bodyRows: 1, rowHeadColumns: 0 }], footRows: 0 },
    { headRows: 1, bodies: [], footRows: 1 },
    { headRows: 0, bodies: [{ headRows: 0, bodyRows: 1, rowHeadColumns: 0 }, { headRows: 0, bodyRows: 1 }], footRows: 0 },
  ])('preserves body partition %j', (rowGroups) => {
    const ast = document({ rowGroups, columns: [{ width: 0.333 }, { width: 0.667 }] })
    const before = toAstJson(ast)
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics).toEqual([])
    const reparsed = parse(result.value!)
    expect(toAstJson(reparsed).children[0]).toMatchObject({ rowGroups })
    expect(renderHtml(reparsed)).toBe(renderHtml(ast))
    expect(toAstJson(ast)).toEqual(before)
    expect(renderCarveWithConversionReport(reparsed).value).toBe(result.value)
  })

  it.each([
    'body-rows=1', 'body-rows=1,1 body-header-rows=0',
    'body-rows=1,1 body-header-cols=x,0', 'body-rows=1,-1',
    'body-header-rows=1', 'body-rows=9007199254740992',
    'body-rows=1,1 body-header-rows=1,0', 'header-rows=1 body-rows=x', 'header-rows=1 body-header-rows=1',
  ])('rejects invalid body metadata %s', (attrs) => {
    const ast = toAstJson(parse(`{${attrs}}\n| a | b |\n| c | d |\n`))
    expect(ast.children[0]).not.toHaveProperty('rowGroups')
    const html = renderHtml(parse(`{${attrs}}\n| a | b |\n| c | d |\n`))
    expect(html).toContain('body-')
    if (/(?:^| )header-rows=1(?: |$)/.test(attrs)) expect(html).toContain('header-rows="1"')
  })

  it('diagnoses retained attributes that conflict with imported bodies', () => {
    const ast = document({ attrs: { keyValues: { 'body-rows': '2' } }, rowGroups: { headRows: 0, bodies: [{ headRows: 1, bodyRows: 1 }], footRows: 0 } })
    const result = renderCarveWithConversionReport(ast)
    expect(result.report.diagnostics.map(d => d.field)).toEqual(['rowGroups'])
    expect(toAstJson(parse(result.value!)).children[0]).toMatchObject({ attrs: { keyValues: { 'body-rows': '2' } } })
  })
})

it('promotes body row-header columns and keeps their scope across spans', () => {
  const ast = parse('{body-rows=2,1 body-header-rows=0,1 body-header-cols=1,0}\n| a | b |\n| ^ | c |\n| ^ | D |\n| e | f |\n')
  const html = renderHtml(ast)
  expect(html).toContain('<th scope="row" rowspan="3">a</th>')
  expect(html).toContain('<th scope="col">D</th>')
  const result = renderCarveWithConversionReport(ast)
  expect(result.report.diagnostics).toEqual([])
  expect(renderHtml(parse(result.value!))).toBe(html)
})
