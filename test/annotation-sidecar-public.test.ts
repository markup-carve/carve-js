import { describe, expect, it } from 'vitest'
import { decodeTree, validateTree, type AnnotationRangeSidecar } from '../public/index.ts'

const tree = { type: 'document', astVersion: '2.0', extensions: [
  { name: 'carve.annotation', version: '1', required: false, slots: [] },
], children: [{ type: 'paragraph', children: [{ type: 'text', value: 'a' }],
  data: { 'carve.annotation': { ids: ['note'] } } }] }
const range: AnnotationRangeSidecar = { ranges: [{ id: 'note', start: { path: '/children/0', offset: 0 },
  end: { path: '/children/0', offset: 1 } }] }

describe('public annotation sidecar reader option', () => {
  it('accepts a matching range on both calls and keeps tree-only behavior', () => {
    expect(() => validateTree(tree, { annotations: range })).not.toThrow()
    expect(decodeTree(JSON.stringify(tree), { annotations: range })).toEqual(tree)
    expect(() => validateTree(tree)).not.toThrow()
    expect(decodeTree(JSON.stringify(tree))).toEqual(tree)
  })

  it('refuses a duplicate range id on both calls', () => {
    const duplicate = { ranges: [...range.ranges, range.ranges[0]!] }
    expect(() => validateTree(tree, { annotations: duplicate })).toThrow('/ranges/1/id')
    expect(() => decodeTree(JSON.stringify(tree), { annotations: duplicate })).toThrow('/ranges/1/id')
  })

  it('checks sidecar shape and UTF-8 byte boundaries', () => {
    const invalid = { ranges: [{ ...range.ranges[0]!, end: { path: '/children/0', offset: -1 } }] }
    expect(() => validateTree(tree, { annotations: invalid })).toThrow('/ranges/0/end')
    const bytes = structuredClone(tree)
    bytes.children[0]!.children[0]!.value = 'é'
    expect(() => validateTree(bytes, { annotations: range })).toThrow('/ranges/0/end/offset')
  })
})
