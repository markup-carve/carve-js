import { describe, expect, it } from 'vitest'
import { CarveTreeError, decodeTree, parse, validateTree } from '../src/index.ts'
import { documentOf, paragraph } from './support/tree.ts'

function refusal(value: unknown): string | null {
  try { decodeTree(JSON.stringify(value)); return null } catch (error) {
    if (!(error instanceof CarveTreeError)) throw error
    return error.message
  }
}

describe('AST 2.0 reader checks', () => {
  it('C2-A-008, C2-A-013, C2-A-019: envelope and document versions agree, including readable minors', () => {
    expect(refusal({ astVersion: '2.1', document: { ...documentOf(), astVersion: '2.1' } })).toBeNull()
    expect(refusal({ astVersion: '2.1', document: documentOf() }))
      .toBe('/document/astVersion: the document and envelope versions differ')
  })

  it('C2-A-029, C2-A-123, C2-A-124, C2-A-125, C2-A-126: names, declarations and fallback are checked', () => {
    const inline = (name: string, fallback?: unknown[]) => documentOf(paragraph({ type: 'inline_extension', name,
      children: [], ...(name.includes('.') ? { version: '1' } : {}), ...(fallback === undefined ? {} : { fallback }) } as never))
    expect(refusal(inline('kbd'))).toBeNull()
    expect(refusal(inline('_'))).toBeNull()
    expect(refusal(inline('bad..name'))).toContain('not an extension name')
    expect(refusal(inline('demo.widget', []))).toContain('an undeclared extension name')
    expect(refusal({ ...inline('demo.widget', []), extensions: [{ name: 'demo.widget', version: '1', required: false, slots: [] }] })).toBeNull()
    expect(refusal({ ...inline('demo.widget'), extensions: [{ name: 'demo.widget', version: '1', required: false, slots: [] }] }))
      .toContain('a required field is missing')
    expect(refusal(documentOf({ type: 'block_extension', name: 'widget', version: '1', children: [], fallback: [] } as never)))
      .toContain('not an extension name')
    const data = documentOf({ ...paragraph('x'), data: { 'demo.widget': 1 } })
    expect(refusal(data)).toContain('an undeclared data name')
    expect(refusal({ ...data, extensions: [{ name: 'demo.widget', version: '1', required: false, slots: [] }] })).toBeNull()
    expect(refusal({ ...documentOf({ ...paragraph('x'), data: { widget: 1 } }),
      extensions: [{ name: 'demo.widget', version: '1', required: false, slots: [] }] })).toContain('not a qualified data name')
  })

  it('C2-A-028, C2-A-122, C2-A-131, C2-A-189: nested objects are closed and opaque objects contain no nodes', () => {
    expect(refusal(documentOf({ ...paragraph(), data: { 'demo.widget': [{ type: 'text', value: 'x' }] } })))
      .toContain('a node in an opaque object')
    expect(refusal(documentOf({ type: 'list', marker: { kind: 'bullet', char: '-' }, spacing: 'tight',
      children: [{ type: 'list_item', task: { mark: 'x', extra: 'done' }, children: [] }] } as never)))
      .toContain('not a field of task')
    const resource = { id: 'r', mediaType: 'image/png', digest: `sha256:${'0'.repeat(64)}` }
    expect(refusal({ ...documentOf(), resources: [{ ...resource, extra: 1 }] })).toContain('not a field of resource')
    expect(refusal({ ...documentOf(), resources: [{ ...resource, size: 1.5 }] })).toContain('not a non-negative byte count')
  })

  it('C2-A-071, C2-A-141, C2-A-142, C2-A-143: positions and levels have positive coordinates', () => {
    const heading = (level: number) => documentOf({ type: 'heading', level, children: [] })
    expect(refusal(heading(0))).toContain('not a count of at least 1')
    const pos = { startLine: 1, endLine: 1, startColumn: 1, endColumn: 2, startOffset: 0, endOffset: 1 }
    expect(refusal(documentOf({ ...paragraph(), pos: { ...pos, startLine: 0 } }))).toContain('below 1')
    expect(refusal(documentOf({ ...paragraph(), pos: { ...pos, file: 3 } } as never))).toContain('not a string')
    expect(() => validateTree(documentOf({ ...paragraph('x'), pos }), undefined, 'x')).not.toThrow()
    expect(() => validateTree(documentOf({ ...paragraph('x'), pos: { ...pos, endColumn: 3 } }), undefined, 'x'))
      .toThrow('coordinates disagree with the source')
  })

  it('C2-A-058, C2-A-092, C2-A-093, C2-A-102: marker, table and math values obey their shapes', () => {
    const list = documentOf({ type: 'list', marker: { kind: 'ordered', start: 1 }, spacing: 'tight', children: [] })
    expect(refusal(list)).toContain('a start of 1 is omitted')
    expect(refusal(documentOf(paragraph({ type: 'math', display: true, value: 'x', number: 1 })))).toContain('stand together')
    const cell = (fields: Record<string, unknown>) => ({ type: 'table_cell', header: false, children: [], ...fields })
    const table = (cells: unknown[]) => documentOf({ type: 'table', columns: [], children: [{ type: 'table_body',
      children: [{ type: 'table_row', children: cells }] }] } as never)
    expect(refusal(table([cell({ colspan: 0 })]))).toContain('not a count of at least 1')
    expect(refusal(table([cell({ valign: 'middle-ish' })]))).toContain('unknown value')
    expect(refusal(table([cell({ colspan: 3 }), cell({ span: 'colspan' })]))).toContain('contradicts its authored span mark')
  })

  it('C2-A-098, C2-A-131, C2-A-188: punctuation kinds and header ids are checked', () => {
    expect(refusal(documentOf(paragraph({ type: 'smart_punctuation', kind: 'invented', source: 'x' } as never))))
      .toContain('unknown value')
    const cell = (header: boolean, id?: string, headerIds?: string[]) => ({ type: 'table_cell', header,
      attrs: id === undefined ? undefined : { id }, headerIds, children: [] })
    const table = (cells: unknown[]) => documentOf({ type: 'table', columns: [], children: [{ type: 'table_body',
      children: [{ type: 'table_row', children: cells }] }] } as never)
    expect(refusal(table([cell(false, 'h'), cell(false, undefined, ['h'])]))).toContain('no header cell has the id')
    expect(refusal(table([cell(true, 'h'), cell(false, undefined, ['h'])]))).toBeNull()
  })

  it('C2-B-015, C2-B-049: a task and a plain item share their matching list', () => {
    const document = parse('- [x] a\n- b')
    expect(document.children).toHaveLength(1)
    expect(document.children[0]).toMatchObject({ type: 'list', children: [{ task: { mark: 'x' } }, { type: 'list_item' }] })
    expect(parse('- a\n* b').children).toHaveLength(2)
  })
})
