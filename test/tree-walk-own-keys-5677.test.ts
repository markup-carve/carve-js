// carve-js#5677: tree equality walks plain records with `for in`; it reads the keys `Object.keys` gives, so a key a
// record inherits is never compared. Validation reads the same keys.
import { describe, expect, it } from 'vitest'
import { parseTree, treesEqual, validateTree } from '../src/index.ts'

function withPrototypeKey(run: () => void): void {
  const prototype = Object.prototype as Record<string, unknown>
  prototype['inherited'] = 1
  try {
    run()
  } finally {
    delete prototype['inherited']
  }
}

describe('a key a record inherits', () => {
  it('is not compared where the prototype of a node holds it', () => {
    const own = { type: 'text', value: 'a' }
    const inherited = Object.assign(Object.create({ extra: 'b' }) as Record<string, unknown>, own)
    const tree = (text: object) => ({ type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [text] }] })
    expect(treesEqual(tree(inherited) as never, tree(own) as never)).toBe(true)
    expect(treesEqual(tree(own) as never, tree(inherited) as never)).toBe(true)
  })

  it('is not compared or checked where Object.prototype holds it', () => {
    const document = parseTree('a *bold* and /em/\n\n| a | b |\n').document
    const copy = structuredClone(document)
    withPrototypeKey(() => {
      expect(treesEqual(document, copy)).toBe(true)
      expect(() => { validateTree(document) }).not.toThrow()
      copy.children[0] = { type: 'paragraph', children: [{ type: 'text', value: 'different' }] }
      expect(treesEqual(document, copy)).toBe(false)
    })
  })

  it('is not read where only one record holds the key as its own', () => {
    Object.defineProperty(Object.prototype, 'extra', { configurable: true, get() { throw new Error('inherited getter read') } })
    try {
      const tree = (text: object) => ({ type: 'document', astVersion: '2.0', children: [{ type: 'paragraph', children: [text] }] })
      expect(treesEqual(tree({ type: 'text', value: 'x', extra: 1 }) as never, tree({ type: 'text', value: 'x' }) as never)).toBe(false)
    } finally {
      delete (Object.prototype as Record<string, unknown>)['extra']
    }
  })

  it('leaves an own key that is not a field refused', () => {
    const document = parseTree('a\n').document as unknown as { children: Record<string, unknown>[] }
    document.children[0]!['unknown'] = 1
    expect(() => { validateTree(document) }).toThrow(/not a field of paragraph/u)
  })
})
