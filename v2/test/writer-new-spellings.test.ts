import { describe, expect, it } from 'vitest'
import { format, parse, treesEqual, writeWithDiagnostics, type DocumentNode } from '../src/index.ts'

function list(value: string): DocumentNode['children'][number] {
  return { type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight',
    children: [{ type: 'list_item', children: [{ type: 'paragraph', children: [{ type: 'text', value }] }] }] }
}

describe('new writer and parser spellings', () => {
  it('C2-W-122, C2-B-091: the following list has its attribute line above the comment', () => {
    const root: DocumentNode = { type: 'document', astVersion: '2.0', children: [list('a'),
      { type: 'comment', form: 'line', value: 'note' }, { ...list('b'), attrs: { classes: ['x'] } }] }
    const written = writeWithDiagnostics(root)
    expect(written.source).toBe('- a\n{.x}\n%% note\n- b\n')
    expect(written.diagnostics).toEqual([])
    expect(treesEqual(parse(written.source), root)).toBe(true)
  })

  it('C2-B-173: a failed span mark in an otherwise header row leaves a header cell', () => {
    const table = parse('|=|^|\n').children[0]
    if (table?.type !== 'table') throw new Error('table absent')
    const head = table.children[0]
    if (head?.type !== 'table_head') throw new Error('head absent')
    const row = head.children[0]
    if (row?.type !== 'table_row') throw new Error('row absent')
    expect(row.children.map((cell) => cell.header)).toEqual([true, true])
  })

  it('C2-W-044: a nested bare-dot list on its parent marker line takes digits', () => {
    const source = '. 1. a\n'
    expect(format(source)).toBe(source)
  })

  it('C2-W-088: an escape before a brace is removed when it changes no tree fact', () => {
    const source = String.raw`x(/u)\//\{/` + '\n'
    expect(format(source)).toBe(String.raw`x(/u)\//{/` + '\n')
  })
})
