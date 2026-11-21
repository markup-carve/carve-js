import { expect, it } from 'vitest'
import { parseTree, treesEqual } from '../src/index.ts'

it('compares tree fields independently of object insertion order', () => {
  const original = parseTree('a *bold* and /em/').document
  const reverseFields = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(reverseFields)
    if (value === null || typeof value !== 'object') return value
    return Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reverseFields(item)]))
  }
  const reordered = reverseFields(original) as typeof original
  expect(treesEqual(original, reordered)).toBe(true)
  reordered.children[0] = { type: 'paragraph', children: [{ type: 'text', value: 'different' }] }
  expect(treesEqual(original, reordered)).toBe(false)
})
