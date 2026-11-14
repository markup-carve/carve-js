import { describe, expect, it } from 'vitest'
import { type DocumentNode, type ImageNode, type Inline, parse, type TableCellNode, type TableNode,
  writeWithDiagnostics } from '../src/index.ts'
import { documentOf, paragraph } from './support/tree.ts'

function losses(document: DocumentNode): string[] {
  return writeWithDiagnostics(document).diagnostics.map((entry) => `${entry.code} ${entry.path}: ${entry.message}`)
}

function tableWith(field: 'scope' | 'headerIds'): DocumentNode {
  const header: TableCellNode = { type: 'table_cell', header: true, attrs: { id: 'h' }, children: [] }
  const data: TableCellNode = { type: 'table_cell', header: false, children: [],
    ...(field === 'scope' ? { scope: 'row' as const } : { headerIds: ['h'] }) }
  const table: TableNode = { type: 'table', columns: [], children: [
    { type: 'table_head', children: [{ type: 'table_row', children: [header] }] },
    { type: 'table_body', children: [{ type: 'table_row', children: [data] }] },
  ] }
  return documentOf(table)
}

describe('writer losses for AST 2.0 fields', () => {
  it('C2-A-175, C2-W-011: accessibility fields are reported by name', () => {
    expect(losses(tableWith('scope')).some((entry) => entry.includes('field scope of a table_cell'))).toBe(true)
    expect(losses(tableWith('headerIds')).some((entry) => entry.includes('field headerIds of a table_cell'))).toBe(true)
  })

  it('C2-A-175, C2-W-011: image and xref fields that source cannot spell are reported', () => {
    const image = (fields: Partial<ImageNode>) => documentOf(paragraph({ type: 'image', src: '/a', alt: 'a', ...fields }))
    expect(losses(image({ longDescription: [paragraph('Long')] })).some((entry) => entry.includes('field longDescription'))).toBe(true)
    expect(losses(documentOf(paragraph({ type: 'image', src: '/a', decorative: true })))
      .some((entry) => entry.includes('field decorative'))).toBe(true)
    expect(losses(documentOf(paragraph({ type: 'xref', key: 'h', namespace: 'heading', display: 'number' })))
      .some((entry) => entry.includes('field display'))).toBe(true)
  })

  it('C2-W-117: typed metadata is reported when it has no Carve spelling', () => {
    expect(losses(documentOf({ ...paragraph('x'), metadata: { title: [{ type: 'text', value: 'T' }] } }))
      .some((entry) => entry.includes('field metadata'))).toBe(true)
  })

  it('C2-W-011: a tree deeper than source nesting reports its loss without retrying the parse', () => {
    let child: Inline = { type: 'text', value: 'a' }
    for (let depth = 0; depth < 33; depth++) child = { type: 'inline_extension', name: 'x', children: [], fallback: [child] }
    expect(() => losses(documentOf(paragraph(child)))).toThrow('fallbacks are nested deeper than 32')
    expect(losses(parse(`${'{^'.repeat(200)}a${'^}'.repeat(200)}\n`))).toEqual([])
  })
})
