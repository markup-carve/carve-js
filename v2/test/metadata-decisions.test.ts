import { describe, expect, it } from 'vitest'
import { forEachSlot, type Node } from '../src/ast.ts'
import { CarveTreeError, decodeTree, render, resolveTree, validateTreeWithAnnotations,
  writeWithDiagnostics, type DocumentNode, type MetadataValue } from '../src/index.ts'

function document(): DocumentNode {
  return { type: 'document', astVersion: '2.0', children: [], metadata: {
    headers: [{ placement: 'first', children: [{ type: 'paragraph', children: [{ type: 'text', value: 'H' }] }] }],
    footers: [{ placement: 'even', children: [] }], abstract: [{ type: 'paragraph', children: [] }],
    keywords: ['carve'], fields: {
      z: { kind: 'map', value: { beta: { kind: 'list', value: [
        { kind: 'inlines', value: [{ type: 'text', value: 'nested' }] },
      ] } } },
      a: { kind: 'blocks', value: [{ type: 'paragraph', children: [{ type: 'text', value: 'first' }] }] },
    },
  } }
}

function refusal(value: unknown): string | null {
  try { decodeTree(JSON.stringify(value)); return null } catch (error) {
    if (!(error instanceof CarveTreeError)) throw error
    return error.message
  }
}

describe('typed metadata and tree declarations', () => {
  it('C2-A-030, C2-A-212: root metadata is typed, closed and reached in code point key order', () => {
    const root = document()
    expect(refusal(root)).toBeNull()
    const paths: string[] = []
    forEachSlot(root, (_nodes, path) => paths.push(path))
    expect(paths.indexOf('metadata/fields/a/value')).toBeLessThan(paths.indexOf('metadata/fields/z/value/beta/value/0/value'))
    if (root.metadata === undefined) throw new Error('metadata absent')
    root.metadata.fields = {
      '😀': { kind: 'inlines', value: [{ type: 'text', value: 'astral' }] },
      '\ue000': { kind: 'inlines', value: [{ type: 'text', value: 'private' }] },
    }
    const unicodePaths: string[] = []
    forEachSlot(root, (_nodes, path) => unicodePaths.push(path))
    expect(unicodePaths.indexOf('metadata/fields/\ue000/value')).toBeLessThan(unicodePaths.indexOf('metadata/fields/😀/value'))
    expect(refusal({ ...root, metadata: { ...root.metadata, headers: [{ placement: 'odd', children: [] }] } }))
      .toContain('invalid placement')
    expect(refusal({ ...root, metadata: { ...root.metadata, fields: { x: { kind: 'string', value: 1 } } } }))
      .toContain('not a string')
  })

  it('C2-A-212: the total named field count and value depth are bounded', () => {
    const root = document()
    if (root.metadata === undefined) throw new Error('metadata absent')
    root.metadata.fields = Object.fromEntries(Array.from({ length: 257 }, (_, at) => [`k${at}`, { kind: 'string', value: 'x' }]))
    expect(refusal(root)).toContain('more than 256 named metadata fields')
    let value: MetadataValue = { kind: 'string', value: 'x' }
    for (let at = 0; at < 64; at++) value = { kind: 'list', value: [value] }
    root.metadata.fields = { deep: value }
    expect(refusal(root)).toContain('nested deeper than 64 levels')
  })

  it('C2-A-017, C2-A-025: extension slots walk in declaration order and undeclared names fail', () => {
    const extension: Node = { type: 'block_extension', name: 'demo.widget', version: '1', children: [], fallback: [],
      slots: { second: [{ type: 'paragraph', children: [] }], first: [{ type: 'paragraph', children: [] }] } }
    const root: DocumentNode = { type: 'document', astVersion: '2.0', children: [extension],
      extensions: [{ name: 'demo.widget', version: '1', required: false, slots: ['first', 'second'] }] }
    expect(refusal(root)).toBeNull()
    const paths: string[] = []
    forEachSlot(extension, (_nodes, path) => paths.push(path), undefined, root.extensions)
    expect(paths.slice(1, 3)).toEqual(['slots/first', 'slots/second'])
    root.extensions?.[0]?.slots.pop()
    expect(refusal(root)).toContain('slot absent from extension declaration')
  })

  it('C2-A-203: a sidecar range must reach the annotated node or its descendant', () => {
    const root: DocumentNode = { type: 'document', astVersion: '2.0',
      extensions: [{ name: 'carve.annotation', version: '1', required: false, slots: [] }],
      children: [{ type: 'paragraph', children: [{ type: 'text', value: 'x', data: { 'carve.annotation': { ids: ['a'] } } }] }] }
    const anchor = { path: '/children/0/children/0', offset: 0 }
    expect(() => validateTreeWithAnnotations(root, { ranges: [{ id: 'a', start: anchor, end: anchor }] })).not.toThrow()
    expect(() => validateTreeWithAnnotations(root, { ranges: [] })).toThrow('has no range')
    expect(() => validateTreeWithAnnotations(root, { ranges: [{ id: 'a', start: { path: '/children/0', offset: 0 },
      end: { path: '/children/0', offset: 1 } }] })).toThrow('has no endpoint')
  })

  it('C2-A-192, C2-W-011: HTML ignores root metadata and the writer reports fields unless frontmatter preserves them', () => {
    const root = document()
    expect(render(root)).toBe('')
    expect(resolveTree(root).document.metadata?.fields?.z?.kind).toBe('map')
    expect(writeWithDiagnostics(root).diagnostics.map((entry) => entry.path)).toContain('/metadata/fields')
    root.children = [{ type: 'frontmatter', format: 'yaml', value: 'x: y\n' }]
    expect(writeWithDiagnostics(root).diagnostics.map((entry) => entry.path)).not.toContain('/metadata/fields')
  })

  it('C2-A-212: resolution and profiles visit inline nodes inside nested metadata values', () => {
    const root: DocumentNode = { type: 'document', astVersion: '2.0',
      children: [{ type: 'link_reference_definition', key: 'r', namespace: 'link', href: '/u' }],
      metadata: { fields: { nested: { kind: 'list', value: [{ kind: 'inlines', value: [
        { type: 'link', key: 'r', namespace: 'link', refForm: 'full', children: [{ type: 'text', value: 'x' }] },
      ] }] } } } }
    const full = resolveTree(structuredClone(root)).document.metadata?.fields?.nested
    const minimal = resolveTree(root, { profile: 'minimal' }).document.metadata?.fields?.nested
    if (full?.kind !== 'list' || minimal?.kind !== 'list') throw new Error('list metadata absent')
    const resolved = full.value[0]
    const degraded = minimal.value[0]
    if (resolved?.kind !== 'inlines' || degraded?.kind !== 'inlines') throw new Error('inline metadata absent')
    expect(resolved.value[0]).toMatchObject({ type: 'link', href: '/u' })
    expect(degraded.value[0]).toEqual({ type: 'text', value: 'x' })
  })
})
