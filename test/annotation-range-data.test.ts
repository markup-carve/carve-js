import { describe, expect, it } from 'vitest'
import { decodeTree, validateTree, type AnnotationRangeSidecar } from '../public/index.ts'

// C2-A-214, C2-A-029: a range may carry data with qualified, declared keys (carve#6885).
const tree = { type: 'document', astVersion: '2.0', extensions: [
  { name: 'x.note', version: '1', required: false, slots: [] },
], children: [{ type: 'paragraph', children: [{ type: 'text', value: 'hello' }] }] }
const sidecar: AnnotationRangeSidecar = { ranges: [{ id: 'r1', start: { path: '/children/0', offset: 0 },
  end: { path: '/children/0', offset: 5 }, data: { 'x.note': { by: 'a' } } }] }

describe('annotation range data', () => {
  it('accepts declared data and keeps it unchanged', () => {
    const json = JSON.stringify(sidecar)
    expect(() => validateTree(tree, { annotations: sidecar })).not.toThrow()
    expect(decodeTree(JSON.stringify(tree), { annotations: sidecar })).toEqual(tree)
    expect(JSON.stringify(sidecar)).toBe(json)
  })

  it('round-trips the sidecar through JSON', () => {
    const read = JSON.parse(JSON.stringify(sidecar)) as AnnotationRangeSidecar
    expect(() => validateTree(tree, { annotations: read })).not.toThrow()
    expect(read).toEqual(sidecar)
  })

  it('accepts a declaration on the envelope', () => {
    const { extensions, ...bare } = tree
    const envelope = { astVersion: '2.0', extensions, document: bare }
    expect(() => decodeTree(JSON.stringify(envelope), { annotations: sidecar })).not.toThrow()
  })

  it('refuses an undeclared data key', () => {
    const bare = { ...tree, extensions: [] }
    expect(() => validateTree(bare, { annotations: sidecar })).toThrow('/ranges/0/data/x.note')
    expect(() => decodeTree(JSON.stringify(bare), { annotations: sidecar })).toThrow('/ranges/0/data/x.note')
  })

  it('refuses an unqualified key, a non-object and a node inside data', () => {
    const unqualified = { ranges: [{ ...sidecar.ranges[0]!, data: { note: 1 } }] }
    expect(() => validateTree(tree, { annotations: unqualified })).toThrow('/ranges/0/data/note')
    const scalar = { ranges: [{ ...sidecar.ranges[0]!, data: 1 }] } as unknown as AnnotationRangeSidecar
    expect(() => validateTree(tree, { annotations: scalar })).toThrow('/ranges/0/data')
    const node = { ranges: [{ ...sidecar.ranges[0]!, data: { 'x.note': { type: 'text', value: 'a' } } }] }
    expect(() => validateTree(tree, { annotations: node })).toThrow('/ranges/0/data/x.note')
  })

  it('keeps the range otherwise closed', () => {
    const extra = { ranges: [{ ...sidecar.ranges[0]!, kind: 'comment' }] } as unknown as AnnotationRangeSidecar
    expect(() => validateTree(tree, { annotations: extra })).toThrow('/ranges/0')
  })
})
