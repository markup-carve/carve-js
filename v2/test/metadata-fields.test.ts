import { expect, it } from 'vitest'
import { decodeTree, encodeTree, render, treesEqual, validateTree, type DocumentNode } from '../src/index.ts'

function document(fields: NonNullable<NonNullable<DocumentNode['metadata']>['fields']>): DocumentNode {
  return { type: 'document', astVersion: '2.0', children: [], metadata: { fields } }
}

it('C2-A-212: a named metadata field holds a nested map', () => {
  const tree = document({ settings: { kind: 'map', value: { nested: { kind: 'map', value: {
    mode: { kind: 'string', value: 'wide' },
  } } } } })
  validateTree(tree)
  expect(treesEqual(decodeTree(encodeTree(tree)), tree)).toBe(true)
})

it('C2-A-212: a named metadata field holds a list and a boolean', () => {
  const tree = document({ flags: { kind: 'list', value: [
    { kind: 'boolean', value: true }, { kind: 'boolean', value: false },
  ] } })
  validateTree(tree)
  expect(treesEqual(decodeTree(encodeTree(tree)), tree)).toBe(true)
})

it('C2-A-212: a named metadata field holds a block value', () => {
  const tree = document({ summary: { kind: 'blocks', value: [
    { type: 'paragraph', children: [{ type: 'text', value: 'Summary' }] },
  ] } })
  validateTree(tree)
  expect(treesEqual(decodeTree(encodeTree(tree)), tree)).toBe(true)
})

it('C2-A-213: a supplied unresolved shortcut reference is valid and renders literally', () => {
  const tree: DocumentNode = { type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [
    { type: 'link', key: 'missing', namespace: 'link', refForm: 'shortcut', children: [{ type: 'text', value: 'Missing' }] },
  ] }] }
  validateTree(tree)
  expect(render(tree)).toContain('[Missing]')
})
