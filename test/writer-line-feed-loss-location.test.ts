import { expect, it } from 'vitest'
import { type Block, type DocumentNode, writeWithDiagnostics } from '../src/index.ts'

const documentOf = (block: Block): DocumentNode => ({ type: 'document', astVersion: '2.0', children: [block] })

it('reports a supplied line feed at its text value through paragraph and line hosts', () => {
  const blocks: Block[] = [
    { type: 'paragraph', children: [{ type: 'text', value: 'a\n\nb' }] },
    { type: 'line_block', children: [{ type: 'line', children: [{ type: 'text', value: 'a\nb' }] }] },
  ]
  for (const [at, block] of blocks.entries()) {
    const result = writeWithDiagnostics(documentOf(block))
    expect(result.source).toBe(at === 0 ? 'a\n\nb\n' : '::: |\na\nb\n:::\n')
    expect(result.diagnostics.map(row => [row.code, row.path])).toEqual([[
      'field-unspellable', at === 0 ? '/children/0/children/0/value' : '/children/0/children/0/children/0/value',
    ]])
  }
})

it('reports a line-block comment that reads back as text at the comment', () => {
  const block = { type: 'line_block', children: [{ type: 'line', children: [
    { type: 'text', value: 'a' }, { type: 'comment', form: 'braced', value: 'c\r\nd' },
  ] }] } as Block
  const result = writeWithDiagnostics(documentOf(block))
  expect(result.source).toBe('::: |\na{% c\r\nd %}\n:::\n')
  expect(result.diagnostics.map(row => [row.code, row.path])).toEqual([[
    'structure-unspellable', '/children/0/children/0/children/1',
  ]])
})

it('keeps an independent section loss and locates a written text loss', () => {
  const pos = { startLine: 1, endLine: 2, startColumn: 1, endColumn: 2, startOffset: 0, endOffset: 3 }
  const paragraph = { type: 'paragraph', children: [{ type: 'text', value: 'a\nb', pos }] } as Block
  const section = { type: 'section', children: [paragraph] } as Block
  expect(writeWithDiagnostics(documentOf(section)).diagnostics).toEqual([
    expect.objectContaining({ code: 'structure-unspellable', path: '/children/0' }),
  ])
  const diagnostics = writeWithDiagnostics(documentOf(paragraph)).diagnostics
  expect(diagnostics).toEqual([expect.objectContaining({ code: 'field-unspellable', path: '/children/0/children/0/value',
    range: { startOffset: 0, endOffset: 3 } })])
})

it('does not report line feeds inside an include expansion it does not write', () => {
  const include = { type: 'include', path: 'a.crv', file: 'a.crv',
    children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a\nb' }] }] } as Block
  const result = writeWithDiagnostics(documentOf(include))
  expect(result.source).toBe('{{ a.crv }}\n')
  expect(result.diagnostics).toEqual([])
})
