import { WIRE_FIELDS } from '../src/wire-fields.js'
import { ownedChildFields } from '../src/owned-child-fields.js'
import { expect, it, vi } from 'vitest'
import { parse, resolve, renderHtml } from '../src/index.js'
import type { Document } from '../src/ast.js'
import { collectDocumentIds, DOCUMENT_ID_CHILD_FIELDS, RECORD_CHILD_FIELDS, DocumentIdRegistry } from '../src/document-ids.js'

it('reserves ids in captions, ruby pairs, definition matrices, footnotes and table body groups', () => {
  const text = (id: string) => ({ type: 'text', value: id, attrs: { id } })
  const doc = { type: 'document', attrs: { id: 'root' }, children: [
    { type: 'figure', target: { type: 'image', src: 'x', alt: 'x' }, caption: [text('caption')], shortCaption: [text('short')] },
    { type: 'paragraph', children: [{ type: 'ruby', pairs: [{ base: [text('base')], annotation: [text('annotation')] }] }] },
    { type: 'definition_list', items: [{ terms: [[text('term')]], definitions: [[{ type: 'paragraph', children: [text('definition')] }]] }] },
    { type: 'table', rows: [{ type: 'table_row', cells: [{ type: 'table_cell', blocks: [{ type: 'paragraph', children: [text('cell')] }] }] }],
      rowGroups: { headAttrs: { id: 'head' }, footAttrs: { id: 'foot' }, bodies: [{ attrs: { id: 'body' }, headRows: 0, bodyRows: 1 }] } },
  ], footnoteDefs: Object.fromEntries([['__proto__', [{ type: 'paragraph', children: [text('prototype-note')] }]], ['note', [{ type: 'paragraph', children: [text('note')] }]]]),
  trailerBlocks: [{ type: 'paragraph', children: [text('trailer')] }] } as unknown as Document
  const registry = collectDocumentIds(doc)
  for (const id of ['root', 'caption', 'short', 'base', 'annotation', 'term', 'definition', 'cell', 'body', 'head', 'foot', 'note', 'prototype-note', 'trailer']) {
    expect(registry.uniqueId(id)).toBe(`${id}-2`)
  }
})

it.each(['future_kind', 'constructor', '__proto__'])('keeps custom node kind %s available to host renderers', (type) => {
  const doc = { type: 'document', children: [{ type, children: [
    { type: 'text', value: 'x', attrs: { id: 'custom' } },
  ] }] } as unknown as Document
  expect(collectDocumentIds(doc).uniqueId('custom')).toBe('custom-2')
})

it('ignores object-valued attribute metadata and positional records', () => {
  const doc = parse('text\n')
  const hidden = { attrs: { id: 'metadata' } }
  doc.children[0]!.attrs = { keyValues: { type: 'widget', hidden } } as never
  doc.children[0]!.pos = { startLine: 1, endLine: 1, hidden } as never
  expect(collectDocumentIds(doc).uniqueId('metadata')).toBe('metadata')
})

it('observes mutations and isolates repeated render suffixes', () => {
  const doc = resolve(parse('{#taken}\nparagraph\n'))
  expect(collectDocumentIds(doc).uniqueId('taken')).toBe('taken-2')
  expect(collectDocumentIds(doc).uniqueId('taken')).toBe('taken-2')
  doc.children[0]!.attrs = { id: 'new' }
  expect(collectDocumentIds(doc).uniqueId('taken')).toBe('taken')
  expect(collectDocumentIds(doc).uniqueId('new')).toBe('new-2')
  expect(renderHtml(doc)).toContain('id="new"')
})

it('collects deeply nested ids without consuming the call stack', () => {
  let node: unknown = { type: 'paragraph', children: [{ type: 'text', value: 'x', attrs: { id: 'deep' } }] }
  for (let depth = 0; depth < 10000; depth++) node = { type: 'block_quote', children: [node] }
  expect(collectDocumentIds({ type: 'document', children: [node] } as Document).uniqueId('deep')).toBe('deep-2')
})

it('covers every schema node kind and all its owned child slots', () => {
  // Text-only array skipping requires text to remain a leaf.
  expect(DOCUMENT_ID_CHILD_FIELDS.text).toEqual([])
  expect(Object.keys(DOCUMENT_ID_CHILD_FIELDS).sort()).toEqual(Object.keys(WIRE_FIELDS).sort())
  for (const [type, fields] of Object.entries(DOCUMENT_ID_CHILD_FIELDS)) {
    expect([...fields].sort(), type).toEqual([...ownedChildFields({ type })].sort())
  }
})

it('reserves ids in host-supplied cross-reference display text', () => {
  const resolvedText = [{ type: 'text', value: 'label', attrs: { id: 'display' } }]
  const doc = { type: 'document', children: [{ type: 'paragraph', children: [
    { type: 'heading_ref', target: 'target', resolvedText },
    { type: 'heading_ref', target: 'target', resolvedText },
  ] }] } as unknown as Document
  expect(collectDocumentIds(doc).uniqueId('display')).toBe('display-2')
})

it('covers schema child slots in untyped runtime records', () => {
  expect([...RECORD_CHILD_FIELDS].sort()).toEqual([...ownedChildFields({})].sort())
})

it('terminates when a host supplies a cyclic node graph', () => {
  const doc: Document = { type: 'document', children: [] }
  doc.children.push(doc as never)
  expect(collectDocumentIds(doc).uniqueId('free')).toBe('free')
})

it.each([['figure', 'target'], ['block_extension', 'fallback'], ['custom', 'target']])(
  'terminates a cycle through the singleton %s.%s slot', (type, field) => {
    const node: Record<string, unknown> = { type, attrs: { id: 'cycle' } }
    node[field] = node
    const doc = { type: 'document', children: [node] } as unknown as Document
    expect(collectDocumentIds(doc).uniqueId('cycle')).toBe('cycle-2')
  },
)

it('reuses the resolved reservations without rebuilding or leaking render-local ids', () => {
  const doc = resolve(parse('{#taken}\nparagraph\n'))
  const reserve = vi.spyOn(DocumentIdRegistry.prototype, 'reserve')
  try {
    const first = collectDocumentIds(doc)
    expect(first.uniqueId('taken')).toBe('taken-2')
    expect(first.uniqueId('generated')).toBe('generated')
    const second = collectDocumentIds(doc)
    expect(second.uniqueId('taken')).toBe('taken-2')
    expect(second.uniqueId('generated')).toBe('generated')
    expect(reserve).not.toHaveBeenCalled()
  } finally { reserve.mockRestore() }
})


it('terminates malformed singleton edges on ordinary nodes and records', () => {
  for (const [type, field] of [['paragraph', 'children'], ['table', 'rows'], [undefined, 'base']]) {
    const node: Record<string, unknown> = { type, attrs: { id: 'cycle' } }
    node[field!] = node
    expect(collectDocumentIds({ type: 'document', children: [node] } as unknown as Document).uniqueId('cycle')).toBe('cycle-2')
  }
  const doc = { type: 'document', children: [], footnoteDefs: {}, trailerBlocks: [] } as unknown as Document
  Object.assign(doc, { footnoteDefs: { a: doc }, trailerBlocks: doc })
  expect(collectDocumentIds(doc).uniqueId('absent')).toBe('absent')
})

it('does not coerce host-supplied type values', () => {
  const node = { type: Object.create(null), base: [{ type: 'text', attrs: { id: 'nested' } }] }
  expect(collectDocumentIds({ type: 'document', children: [node] } as unknown as Document).uniqueId('nested')).toBe('nested-2')
})

it('observes IDs added to a single text child after resolution', () => {
  const doc = resolve(parse('plain text\n'))
  const paragraph = doc.children[0]!
  if (paragraph.type !== 'paragraph') throw new Error('Expected a paragraph')
  expect(paragraph.children).toHaveLength(1)
  expect(collectDocumentIds(doc).uniqueId('added')).toBe('added')
  paragraph.children[0]!.attrs = { id: 'added' }
  expect(collectDocumentIds(doc).uniqueId('added')).toBe('added-2')
  delete paragraph.children[0]!.attrs
  expect(collectDocumentIds(doc).uniqueId('added')).toBe('added')
})

it('terminates a single-element array that refers to itself', () => {
  const children: unknown[] = []
  children.push(children)
  const doc = { type: 'document', children } as unknown as Document
  expect(collectDocumentIds(doc).uniqueId('free')).toBe('free')
})
