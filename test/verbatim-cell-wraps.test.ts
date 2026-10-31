import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { carveToHtml, fromAstJson, parse, renderCarve, toAstJson } from '../src/index.js'

interface AcceptanceRow {
  id: string
  source: string
  path: string
  continuationLines?: number
  expected: unknown
}

const acceptance = JSON.parse(
  readFileSync(new URL('../spec/resources/ast-cell-wraps-acceptance.json', import.meta.url), 'utf8'),
) as { rows: AcceptanceRow[] }

function withoutPos(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutPos)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'pos').map(([key, child]) => [key, withoutPos(child)]))
  }
  return value
}

function atPointer(tree: unknown, pointer: string): unknown {
  return pointer.split('/').slice(1).reduce<unknown>((value, segment) => (value as Record<string, unknown> | undefined)?.[segment], tree)
}

const cellOf = (source: string) => withoutPos(atPointer(parse(source), '/children/0/rows/0/cells/0/children'))

describe('a continuation join inside a verbatim inline', () => {
  // Every row, aheadOfPin or not: the flags wait on this engine.
  for (const row of acceptance.rows) {
    it(`matches the acceptance row ${row.id}`, () => {
      const tree = parse(row.source)
      expect((atPointer(tree, '/children/0/rows/0') as { continuationLines?: number }).continuationLines).toBe(row.continuationLines ?? 1)
      expect(withoutPos(atPointer(tree, row.path))).toEqual(row.expected)
    })

    it(`writes ${row.id} so it reads back the same`, () => {
      const tree = parse(row.source)
      expect(withoutPos(parse(renderCarve(tree)).children)).toEqual(withoutPos(tree.children))
    })
  }

  it('puts each remainder on the plus line its entry names', () => {
    expect(renderCarve(parse('| `a |\n+ |\n+ b` |\n'))).toBe('| `a |\n+ |\n+ b` |\n')
    expect(renderCarve(parse('| $`a | z |\n+ b` | w |\n'))).toBe('| $`a | z |\n+ b` | w |\n')
    expect(renderCarve(parse('| `<b | z |\n+ c>`{=html} | w |\n'))).toBe('| `<b | z |\n+ c>`{=html} | w |\n')
  })

  it('reads and writes cellWraps through AST JSON', () => {
    const source = '| `a | z |\n+ b` | w |\n'
    const doc = fromAstJson(JSON.parse(JSON.stringify(toAstJson(parse(source)))))
    expect(withoutPos(atPointer(doc, '/children/0/rows/0/cells/0/children'))).toEqual([
      { type: 'code', value: 'a | z b', cellWraps: [{ offset: 5, line: 1 }] },
    ])
    expect(renderCarve(doc)).toBe('| `a | z |\n+ b` | w |\n')
  })

  it('counts the offset in codepoints and drops padding first', () => {
    expect(cellOf('| `a😀 |\n+ b` |\n')).toEqual([{ type: 'code', value: 'a😀 b', cellWraps: [{ offset: 2, line: 1 }] }])
    expect(cellOf('| ` a |\n+ b |\n+ c ` |\n')).toEqual([
      { type: 'code', value: 'a b c', cellWraps: [{ offset: 1, line: 1 }, { offset: 3, line: 2 }] },
    ])
    expect(renderCarve(parse('| `a😀 |\n+ b` |\n'))).toBe('| `a😀 |\n+ b` |\n')
  })

  it('keeps joins consumed as opening or closing code-span padding', () => {
    for (const [source, value, offset] of [
      ['| ` |\n+ b ` |\n', 'b', 0],
      ['| ` a |\n+ ` |\n', 'a', 1],
    ] as const) {
      expect(cellOf(source)).toEqual([{ type: 'code', value, cellWraps: [{ offset, line: 1 }] }])
      expect(withoutPos(parse(renderCarve(parse(source))).children)).toEqual(withoutPos(parse(source).children))
    }
  })

  it('does not apply table boundary markers outside a table cell', () => {
    const doc = parse('`b`\n')
    const code = atPointer(doc, '/children/0/children/0') as { cellWraps?: Array<{ offset: number; line: number }> }
    code.cellWraps = [{ offset: 0, line: 1 }]
    expect(renderCarve(doc)).toBe('`b`\n')
  })

  it('carries a join into an unclosed code span', () => {
    expect(cellOf('| `a |\n+ b |\n')).toEqual([{ type: 'code', value: 'a b', cellWraps: [{ offset: 1, line: 1 }] }])
  })

  it('leaves the field off a span no join crosses and keeps rendering unchanged', () => {
    expect(cellOf('| `a b` |\n+ c |\n')).toEqual([{ type: 'code', value: 'a b' }, { type: 'cell_wrap', line: 1 }, { type: 'text', value: 'c' }])
    expect(carveToHtml('| `a |\n+ b` |\n')).toBe(carveToHtml('| `a b` |\n'))
  })

  it('refuses an interior offset that does not name a space', () => {
    const doc = parse('| `a |\n+ b` |\n')
    const code = atPointer(doc, '/children/0/rows/0/cells/0/children/0') as { cellWraps: Array<{ offset: number }> }
    code.cellWraps[0]!.offset = 2
    expect(() => renderCarve(doc)).toThrow(/cellWraps offset/)
  })
})
