// carve-js#5069: the extension passes do the same work in less time. Each case pins a behavior the faster paths
// must keep, and the growth guards fail where a pass turns quadratic again.
import { describe, expect, it } from 'vitest'
import { parse, render, renderWithDocumentTransforms, type BlockExtensionNode, type DocumentNode } from '../src/index.ts'
import { cloneTree, sameTree } from '../src/ast.ts'
import { details } from '../extensions/blocks/details.ts'
import { growthRatio } from './support/growth.ts'

function divSource(source: string): string | undefined {
  const node = parse(source, { extensions: details().extensions, positions: false }).children[0] as BlockExtensionNode
  return node.source?.body
}

describe('cloneTree', () => {
  it('copies a tree of plain values like structuredClone', () => {
    const tree = { type: 'document', children: [{ type: 'text', value: 'a', n: 1, flag: true, none: null, gone: undefined }] }
    const copy = cloneTree(tree)
    expect(copy).toStrictEqual(structuredClone(tree))
    expect(Object.keys(copy.children[0]!)).toEqual(Object.keys(tree.children[0]!))
    expect(copy.children).not.toBe(tree.children)
  })

  it('leaves values that are not plain to structuredClone', () => {
    const date = new Date(0)
    const copy = cloneTree({ when: date, sparse: [1, , 3] })
    expect(copy.when).toBeInstanceOf(Date)
    expect(copy.when).not.toBe(date)
    expect(1 in copy.sparse).toBe(false)
    expect(() => cloneTree({ run: () => 1 })).toThrow()
  })
})

describe('sameTree', () => {
  it('compares values and the order of keys', () => {
    expect(sameTree({ a: [1, { b: 'x' }] }, { a: [1, { b: 'x' }] })).toBe(true)
    expect(sameTree({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(false)
    expect(sameTree({ a: undefined }, {})).toBe(false)
    expect(sameTree([1, 2], [1, 2, 3])).toBe(false)
    expect(sameTree(0, -0)).toBe(false)
  })
})

describe('C2-X-053: transforms that leave the view as it was', () => {
  it('accepts them, and still refuses a later transform whose output is invalid', () => {
    const same = { name: 'same', transform: (view: DocumentNode) => view }
    const broken = { name: 'broken', transform: (view: DocumentNode) => ({ ...view, children: [{ type: 'nope' }] } as unknown as DocumentNode) }
    const kept = renderWithDocumentTransforms('a *b*', [same, same])
    expect(kept.html).toBe(render('a *b*'))
    expect(kept.diagnostics).toEqual([])
    const refused = renderWithDocumentTransforms('a *b*', [same, broken, same])
    expect(refused.html).toBe(render('a *b*'))
    expect(refused.diagnostics.map((entry) => entry.message)).toEqual([
      'The document transform broken failed: /children/0: unknown node type nope',
    ])
  })
})

describe('C2-X-026, C2-W-089: a claimed div is written in the context of the link definitions', () => {
  it('keeps the escape that a defined key needs', () => {
    expect(divSource('::: details "More"\nA \\[r] and [r] and [q][].\n:::\n\n[r]: https://example.com\n'))
      .toBe('A \\[r] and [r] and [q][].\n')
  })

  it('writes the body the same with many definitions after it', () => {
    const definitions = Array.from({ length: 50 }, (_, at) => `[k${at}]: /u${at}\n`).join('')
    expect(divSource(`::: details "More"\nSee [x][k3] and \\[k7].\n:::\n\n${definitions}`)).toBe('See [x][k3] and \\[k7].\n')
  })

  it('grows linearly with claimed divs and definitions', () => {
    const shape = (n: number): string => Array.from({ length: n },
      (_, at) => `::: details "D${at}"\nSee [x][k${at}].\n:::\n\n[k${at}]: /u${at}\n\n`).join('')
    const small = shape(25)
    const large = shape(400)
    const options = { extensions: details().extensions, positions: false }
    const { ratio, times } = growthRatio(() => { parse(small, options) }, () => { parse(large, options) })
    expect(ratio, times.map((time) => time.toFixed(1)).join(', ')).toBeLessThan(48)
  })
})
