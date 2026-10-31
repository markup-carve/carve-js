import { describe, expect, it } from 'vitest'
import { AstJsonSchemaError, fromAstJson, parse, toAstJson } from '../src/index.js'

const cellWire = () => {
  const wire = toAstJson(parse('|= H |\n| a |\n'))
  const table = wire.children.find(child => child.type === 'table') as unknown as {
    rows: Array<{ cells: Array<Record<string, unknown>> }>
  }
  return { wire, cell: table.rows[1]!.cells[0]! }
}

describe('ingested table span defaults', () => {
  it('decodes and omits an explicit span of one on either axis', () => {
    const { wire, cell } = cellWire()
    cell.colspan = 1
    cell.rowspan = 1

    const encoded = toAstJson(fromAstJson(wire))
    const table = encoded.children.find(child => child.type === 'table') as unknown as {
      rows: Array<{ cells: Array<Record<string, unknown>> }>
    }
    expect(table.rows[1]!.cells[0]).not.toHaveProperty('colspan')
    expect(table.rows[1]!.cells[0]).not.toHaveProperty('rowspan')
  })

  it.each([
    ['colspan', 0], ['colspan', -1],
    ['rowspan', 0], ['rowspan', -1],
  ] as const)('rejects %s of %i at decode', (field, value) => {
    const { wire, cell } = cellWire()
    cell[field] = value
    expect(() => fromAstJson(wire)).toThrow(AstJsonSchemaError)
  })
})
