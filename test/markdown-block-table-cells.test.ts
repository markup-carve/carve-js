import { expect, it } from 'vitest'
import { fromAstJson, renderCarveWithConversionReport, renderMarkdownWithReport } from '../src/index.js'

it('flattens heading, list, and code blocks in Markdown table cells with conversion diagnostics', () => {
  const text = (value: string) => ({ type: 'text', value })
  const cell = (blocks: object[]) => ({ type: 'table_cell', header: false, blocks })
  const doc = fromAstJson({
    type: 'document', srcByteLength: 0, children: [{ type: 'table', rows: [{ type: 'table_row', cells: [
      cell([{ type: 'heading', level: 2, children: [text('Head')] }]),
      cell([{ type: 'list', ordered: false, tight: true, items: [
        { type: 'list_item', children: [{ type: 'paragraph', children: [text('one')] }] },
        { type: 'list_item', children: [{ type: 'paragraph', children: [text('two')] }] },
      ] }]),
      cell([{ type: 'code_block', content: 'a\nb\n' }]),
    ] }] }],
  } as never)

  const markdown = renderMarkdownWithReport(doc)
  expect(markdown.value).toBe('|  |  |  |\n| --- | --- | --- |\n| Head | one two | a b |\n')
  expect(markdown.losses).toEqual([])

  const { report } = renderCarveWithConversionReport(doc)
  expect(report.diagnostics.map(row => [row.code, row.node, row.field])).toEqual([
    ['field-unspellable', 'table_cell', 'blocks'],
    ['field-unspellable', 'table_cell', 'blocks'],
    ['field-unspellable', 'table_cell', 'blocks'],
  ])
  expect(report.totalDiagnostics).toBe(3)
})
