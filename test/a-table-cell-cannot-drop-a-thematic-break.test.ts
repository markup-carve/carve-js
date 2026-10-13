import { expect, it } from 'vitest'
import { renderCarve, SourceUnspellableError, type Document } from '../src/index.js'
import { renderCarveWithConversionReport } from '../src/conversion-diagnostics.js'

it('refuses a thematic break in a table cell and reports the refusal', () => {
  const breakNode = { type: 'thematic_break' } as const
  const ast = {
    type: 'document',
    children: [{ type: 'table', rows: [{ type: 'table_row', cells: [
      { type: 'table_cell', header: false, blocks: [breakNode] },
    ] }] }],
  } as Document

  expect(() => renderCarve(ast)).toThrow(SourceUnspellableError)
  const result = renderCarveWithConversionReport(ast, renderCarve)
  expect(result.value).toBeUndefined()
  expect(result.report.diagnostics).toContainEqual(expect.objectContaining({
    code: 'structure-unspellable', node: 'thematic_break',
  }))
})
