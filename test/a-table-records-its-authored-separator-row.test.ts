import { describe, expect, it } from 'vitest'
import {
  carveToCarve,
  fromAstJson,
  parse,
  renderCarve,
  toAstJson,
  toAstEnvelope,
} from '../src/index.js'
import { WIRE_FIELDS, WIRE_VALUE_KINDS } from '../src/wire-fields.js'
import type { Table } from '../src/ast.js'

/*
 * `table.separatorWidths` (markup-carve/carve#2894): PART 12 §3, PART 11 §6h
 * [CARVE-P11-066], PART 10 §13a, PART 12 §34.
 *
 * A header has two spellings - `|= a |= b |`, and a plain row above a
 * `|---|---|` separator - and they parse to the same rows and the same
 * alignments. The field records which one the author wrote, so its PRESENCE is
 * the larger half of what it carries.
 */

const tableOf = (src: string): Table => {
  const table = parse(src).children.find((block) => block.type === 'table')
  if (table?.type !== 'table') throw new Error('no table')
  return table
}

const wireTable = (src: string): Record<string, unknown> =>
  JSON.parse(JSON.stringify(toAstJson(parse(src)).children[0])) as Record<string, unknown>

describe('the parser records the authored dash runs', () => {
  it('counts the dashes, with the alignment colons excluded', () => {
    expect(tableOf('| a | b |\n|:-----|---:|\n| 1 | 2 |\n').separatorWidths).toEqual([5, 3])
  })

  it('records the canonical three as well, because presence is the distinction', () => {
    expect(tableOf('| a | b |\n|---|---|\n| 1 | 2 |\n').separatorWidths).toEqual([3, 3])
  })

  it('records a center cell from both colons and a one-dash cell', () => {
    expect(tableOf('| a | b |\n|:-:|-|\n| 1 | 2 |\n').separatorWidths).toEqual([1, 1])
  })

  it('records one entry per SEPARATOR cell, not per column', () => {
    // The ragged case: the separator row names fewer cells than the header row.
    expect(tableOf('| a | b |\n|---|\n| 1 | 2 |\n').separatorWidths).toEqual([3])
  })

  it('records nothing where the author wrote no separator row', () => {
    expect(tableOf('|= a |= b |\n| 1 | 2 |\n').separatorWidths).toBeUndefined()
    expect(tableOf('| a | b |\n| 1 | 2 |\n').separatorWidths).toBeUndefined()
  })

  it('records nothing for a dash row that is not a separator row', () => {
    // A cell carrying author attributes is content, so its row never promotes.
    expect(tableOf('| a |\n|{.x} ---|\n| 1 |\n').separatorWidths).toBeUndefined()
    // And a delimiter row anywhere but second is an ordinary data row.
    expect(tableOf('| a |\n| 1 |\n|---|\n').separatorWidths).toBeUndefined()
  })
})

describe('the field is published on the wire', () => {
  it('the schema names it on table, and nowhere else', () => {
    expect(WIRE_FIELDS['table']).toContain('separatorWidths')
    expect(WIRE_VALUE_KINDS['table']?.['separatorWidths']).toBe('array')
    const elsewhere = Object.entries(WIRE_FIELDS).filter(
      ([type, fields]) => type !== 'table' && fields.includes('separatorWidths'),
    )
    expect(elsewhere).toEqual([])
  })

  it('toAstJson writes it', () => {
    expect(wireTable('| a | b |\n|:-----|---:|\n| 1 | 2 |\n')['separatorWidths']).toEqual([5, 3])
  })

  it('toAstJson omits it where the author wrote no separator row', () => {
    expect(Object.keys(wireTable('|= a |= b |\n| 1 | 2 |\n'))).not.toContain('separatorWidths')
  })

  it('fromAstJson accepts it and reproduces the row on the way out', () => {
    const payload = JSON.parse(JSON.stringify(toAstJson(parse('| a | b |\n|:-----|---:|\n| 1 | 2 |\n'))))
    expect(renderCarve(fromAstJson(payload))).toBe('| a | b |\n|:-----|---:|\n| 1 | 2 |\n')
  })

  it('the schema stays CLOSED beside it', () => {
    // The field is published, not a licence to pass anything through: the
    // answer §11 ruled cannot be right is still not taken.
    const payload = JSON.parse(JSON.stringify(toAstJson(parse('| a |\n|---|\n| 1 |\n')))) as {
      children: Record<string, unknown>[]
    }
    payload.children[0]!['separatorWidthz'] = [3]
    expect(() => fromAstJson(payload)).toThrow()
  })

  it('the envelope announces contract 1.1, which this field is the minor bump for', () => {
    expect(toAstEnvelope(parse('| a |\n|---|\n| 1 |\n')).astVersion).toBe('1.1')
  })
})

describe('the writer reproduces the field', () => {
  it.each([
    ['| a | b |\n|:-----|---:|\n| 1 | 2 |\n'],
    ['| a | b |\n|---|---|\n| 1 | 2 |\n'],
    ['| a | b |\n|:-:|:----:|\n| 1 | 2 |\n'],
    ['| a |\n|-|\n| 1 |\n'],
    ['| a | b |\n|---|\n| 1 | 2 |\n'],
    ['|= a |= b |\n| 1 | 2 |\n'],
  ])('round-trips %j byte-identically', (src) => {
    expect(carveToCarve(src)).toBe(src)
  })

  it('writes the colon from the CELL alignment, not from a second record of it', () => {
    const table = tableOf('|= a |= b |\n| 1 | 2 |\n')
    table.separatorWidths = [4, 2]
    table.rows[0]!.cells[0]!.align = 'center'
    table.rows[0]!.cells[1]!.align = 'right'
    expect(renderCarve({ type: 'document', children: [table] })).toBe(
      '| a | b |\n|:----:|--:|\n| 1 | 2 |\n',
    )
  })

  it('writes 1 for a width below 1', () => {
    const table = tableOf('|= a |\n| 1 |\n')
    table.separatorWidths = [0]
    expect(renderCarve({ type: 'document', children: [table] })).toBe('| a |\n|-|\n| 1 |\n')
  })

  it('spells the cells that exist and no further', () => {
    const wide = tableOf('|= a |= b |\n| 1 | 2 |\n')
    wide.separatorWidths = [3, 3, 3, 3]
    expect(renderCarve({ type: 'document', children: [wide] })).toBe(
      '| a | b |\n|---|---|\n| 1 | 2 |\n',
    )
    const narrow = tableOf('|= a |= b |\n| 1 | 2 |\n')
    narrow.separatorWidths = [4]
    expect(renderCarve({ type: 'document', children: [narrow] })).toBe(
      '| a | b |\n|----|\n| 1 | 2 |\n',
    )
  })

  it('writes the native form where the first row is not all header cells', () => {
    // The row AFTER a separator is what promotes it, so writing one there would
    // say something the tree does not.
    const table = tableOf('| a | b |\n| 1 | 2 |\n')
    table.separatorWidths = [3, 3]
    expect(renderCarve({ type: 'document', children: [table] })).toBe('| a | b |\n| 1 | 2 |\n')
  })
})
