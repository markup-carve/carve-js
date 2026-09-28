import { describe, expect, it } from 'vitest'
import type { InlineNode } from '../src/ast.js'
import { visitInlineChildren } from '../src/inline-children.js'

describe('authored inline children', () => {
  it('visits ruby base and annotation child lists', () => {
    const seen: InlineNode[][] = []
    const ruby: InlineNode = { type: 'ruby', pairs: [{ base: [{ type: 'text', value: '漢' }], annotation: [{ type: 'text', value: 'kan' }] }] }
    visitInlineChildren(ruby, children => { seen.push(children) }, undefined)
    expect(seen).toEqual([ruby.pairs[0]?.base, ruby.pairs[0]?.annotation])
  })
})
