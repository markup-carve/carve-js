import { describe, expect, it } from 'vitest'
import { type DocumentNode, parse, type TableNode, writeWithDiagnostics } from '../src/index.ts'
import { documentOf } from './support/tree.ts'

type Group = TableNode['children'][number]

const group = (type: 'table_head' | 'table_body' | 'table_foot', id?: string): Group =>
  ({ type, ...(id === undefined ? {} : { attrs: { id } }), children: [] }) as Group

function tableOf(children: Group[]): DocumentNode {
  return documentOf({ type: 'table', columns: [{ type: 'table_column' }], children })
}

const FENCE = '```'

describe('C2-L-036, C2-W-066: a table without rows is written as a delimited table', () => {
  it('writes the delimited form for a head, a body and a foot that all carry attributes', () => {
    const { source, diagnostics } = writeWithDiagnostics(tableOf([group('table_head', 'h'), group('table_body', 'b'),
      group('table_foot', 'f')]))
    expect(source).toBe(`{table body-rows=0}\n${FENCE}csv\n${FENCE}\n`)
    expect(diagnostics.map((entry) => `${entry.code} ${entry.path}`).sort()).toEqual([
      'field-unspellable /children/0/children/1/attrs',
      'field-unspellable /children/0/columns',
      'structure-unspellable /children/0/children/0',
      'structure-unspellable /children/0/children/2',
    ])
    expect(parse(source).children[0]?.type).toBe('table')
  })

  it('never writes a bare attribute line or drops the table silently', () => {
    const shapes: Group[][] = [
      [group('table_foot', 'f')],
      [group('table_foot')],
      [group('table_body'), group('table_foot')],
      [group('table_head', 'h'), group('table_body', 'b')],
      [group('table_body'), group('table_body')],
    ]
    for (const shape of shapes) {
      const { source, diagnostics } = writeWithDiagnostics(tableOf(shape))
      const label = JSON.stringify(shape)
      expect(source, label).toMatch(/^\{table[^}]*\}\n```csv\n```\n$/)
      expect(parse(source).children[0]?.type, label).toBe('table')
      const lost = shape.filter((entry) => entry.type !== 'table_body' || entry.attrs !== undefined)
      for (const entry of lost) {
        const path = `/children/0/children/${shape.indexOf(entry)}`
        expect(diagnostics.some((finding) => finding.path === path || finding.path === `${path}/attrs`), `${label} ${path}`).toBe(true)
      }
    }
  })
})
