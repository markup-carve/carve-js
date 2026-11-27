import { describe, expect, it } from 'vitest'
import { type AnnotationRangeSidecar, applyPatch, decodeTree, encodeEnvelope, encodeTree, validateTree } from '../public/index.ts'

// C2-A-013 (carve#6888, reading A): decodeTree of an envelope appends the envelope declarations its root lacks.
const note = { name: 'x.note', version: '1', required: false, slots: [] }
const other = { name: 'x.other', version: '2', required: false, slots: [] }
const paragraph = { type: 'paragraph', data: { 'x.note': { by: 'a' } }, children: [{ type: 'text', value: 'Hello' }] }
const document = { type: 'document', astVersion: '2.0', children: [paragraph] }
const envelope = JSON.stringify({ astVersion: '2.0', extensions: [note], document })
const sidecar: AnnotationRangeSidecar = { ranges: [{ id: 'r1', start: { path: '/children/0/children/0', offset: 0 },
  end: { path: '/children/0/children/0', offset: 5 }, data: { 'x.note': { by: 'b' } } }] }
const lifted = { ...document, extensions: [note] }

describe('envelope declarations on the decoded tree', () => {
  it('lifts an envelope-only declaration onto the root', () => {
    expect(decodeTree(envelope)).toEqual(lifted)
    expect(decodeTree(envelope, { annotations: sidecar })).toEqual(lifted)
  })

  it('leaves a tree every later call accepts', () => {
    const tree = decodeTree(envelope)
    expect(() => validateTree(tree)).not.toThrow()
    expect(() => validateTree(tree, { annotations: sidecar })).not.toThrow()
    expect(decodeTree(encodeEnvelope(tree))).toEqual(lifted)
    expect(decodeTree(encodeTree(tree))).toEqual(lifted)
    expect(applyPatch(tree, [{ op: 'test', path: '/astVersion', value: '2.0' }])).toEqual(lifted)
  })

  it('writes the lifted declaration on the document root', () => {
    expect(JSON.parse(encodeEnvelope(decodeTree(envelope)))).toEqual({ astVersion: '2.0', extensions: [note], document: lifted })
  })

  it('keeps root entries first and adds no duplicate', () => {
    const both = JSON.stringify({ astVersion: '2.0', extensions: [other, note], document: { ...document, extensions: [note] } })
    expect(decodeTree(both).extensions).toEqual([note, other])
  })

  it('appends envelope-only entries in envelope order', () => {
    const two = JSON.stringify({ astVersion: '2.0', extensions: [other, note], document })
    expect(decodeTree(two).extensions).toEqual([other, note])
  })

  it('leaves a root that declares everything unchanged', () => {
    const full = { ...document, extensions: [note] }
    const tree = decodeTree(JSON.stringify(full))
    expect(encodeTree(decodeTree(JSON.stringify({ astVersion: '2.0', extensions: [note], document: full })))).toBe(encodeTree(tree))
    expect(decodeTree(JSON.stringify({ astVersion: '2.0', document: { type: 'document', astVersion: '2.0', children: [] } }))
      .extensions).toBeUndefined()
  })
})
