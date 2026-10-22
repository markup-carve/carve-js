import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  carveToAnsiWithReport, carveToCarveWithReport, carveToHtmlWithReport,
  carveToMarkdownWithReport, carveToPlainTextWithReport, renderMarkdownWithReport,
} from '../src/index.js'
import { RenderLossError, type RenderLoss } from '../src/render/render-loss.js'

const schema = JSON.parse(readFileSync(new URL('../spec/resources/render-loss-report.schema.json', import.meta.url), 'utf8'))
const source = '|= System |= Limit | < |\n| A | Cold | 20 |\n| ^ | Hot | 10 |\n'

function expectSchemaLoss(loss: RenderLoss): void {
  const fields = loss as unknown as Record<string, unknown>
  const item = schema.properties.losses.items
  const branch = item.oneOf.find((rule: { properties: { code: { const: string } } }) => rule.properties.code.const === loss.code)
  expect(branch).toBeDefined()
  for (const field of item.required) expect(loss).toHaveProperty(field)
  for (const field of branch.required ?? []) expect(loss).toHaveProperty(field)
  for (const [field, value] of Object.entries(loss)) {
    expect(item.properties).toHaveProperty(field)
    const rule = branch.properties[field] ?? item.properties[field]
    expect(rule).not.toBe(false)
    if (rule?.const !== undefined) expect(value).toBe(rule.const)
    if (rule?.enum) expect(rule.enum).toContain(value)
    if (rule?.minimum !== undefined) expect(value).toBeGreaterThanOrEqual(rule.minimum)
  }
  if (loss.code === 'table-span-flattened') expect('colspan' in fields || 'rowspan' in fields).toBe(true)
}

describe('table render losses', () => {
  for (const [target, render] of [
    ['markdown', carveToMarkdownWithReport],
    ['plain', carveToPlainTextWithReport],
    ['ansi', carveToAnsiWithReport],
  ] as const) {
    it(`reports each flattened cell once on ${target}`, () => {
      const result = render(source)
      expect(result.totalLosses).toBe(2)
      expect(result.losses.map(({ code, ...loss }) => ({ code, colspan: 'colspan' in loss ? loss.colspan : undefined, rowspan: 'rowspan' in loss ? loss.rowspan : undefined }))).toEqual([
        { code: 'table-span-flattened', colspan: 2, rowspan: undefined },
        { code: 'table-span-flattened', colspan: undefined, rowspan: 2 },
      ])
      for (const loss of result.losses) {
        expect(loss).toMatchObject({ target, nodeType: 'block', message: 'Flattened a spanning table cell into separate cells' })
        expect(loss.pos).toBeDefined()
        expectSchemaLoss(loss)
      }
      expect(() => render(source, { strictLosses: true })).toThrow(RenderLossError)
    })
  }

  it('reports both counts on one cell', () => {
    const both = '|= Wide | < |\n| ^ | ^ |\n'
    const losses = carveToMarkdownWithReport(both).losses.filter(loss => loss.code === 'table-span-flattened')
    expect(losses).toHaveLength(1)
    expect(losses[0]).toMatchObject({ colspan: 2, rowspan: 2 })
    expectSchemaLoss(losses[0]!)
  })

  it('preserves spans in HTML and canonical Carve', () => {
    expect(carveToHtmlWithReport(source).losses).toEqual([])
    expect(carveToCarveWithReport(source).losses).toEqual([])
  })

  it('reports a later header row only on Markdown', () => {
    const headers = '|= First |\n|= Second |\n| Body |\n'
    const result = carveToMarkdownWithReport(headers)
    expect(result.losses).toHaveLength(1)
    expect(result.losses[0]).toMatchObject({ code: 'table-header-row-demoted', target: 'markdown', nodeType: 'block', message: 'Wrote a later header row as a body row' })
    expect(result.losses[0]?.pos).toBeDefined()
    expectSchemaLoss(result.losses[0]!)
    expect(carveToPlainTextWithReport(headers).losses).toEqual([])
    expect(carveToAnsiWithReport(headers).losses).toEqual([])
  })

  it('reports row loss before cell and content losses', () => {
    const ast = {
      type: 'document', children: [{ type: 'table', rows: [
        { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [{ type: 'text', value: 'First' }] }] },
        { type: 'table_row', cells: [{ type: 'table_cell', header: true, children: [{ type: 'raw_inline', format: 'latex', content: 'x' }] }, { type: 'table_cell', header: false, span: 'colspan', children: [] }] },
      ] }],
    } as Parameters<typeof renderMarkdownWithReport>[0]
    expect(renderMarkdownWithReport(ast).losses.map(loss => loss.code)).toEqual([
      'table-header-row-demoted', 'table-span-flattened', 'raw-format-dropped',
    ])
  })
})
