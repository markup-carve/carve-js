import { describe, expect, it } from 'vitest'
import { forEachSlot, type Node } from '../src/ast.ts'
import { treesEqual, validateTree } from '../src/index.ts'
import { documentOf, paragraph, text } from './support/tree.ts'

describe('generated AST tables', () => {
  it('C2-A-024, C2-A-025: a walk visits declared slots and skips opaque objects', () => {
    const node: Node = {
      type: 'ruby', pairs: [{ type: 'ruby_pair', base: [text('a')], annotation: [text('b')] }],
      metadata: { title: [text('title')], bibliography: { containerTitle: [text('container')] } },
      data: { 'demo.value': { type: 'text', value: 'hidden' } },
    }
    const slots: string[] = []
    forEachSlot(node, (nodes, step) => { if (nodes.length > 0) slots.push(step) })
    expect(slots).toEqual(['pairs', 'metadata/title', 'metadata/bibliography/containerTitle'])
    const pairSlots: string[] = []
    forEachSlot(node.pairs[0]!, (_nodes, step) => pairSlots.push(step))
    expect(pairSlots).toEqual(['base', 'annotation'])
  })

  it('C2-A-189: a node-shaped value inside opaque data or props is refused at its path', () => {
    const data = documentOf({ ...paragraph('x'), data: { 'demo.value': [{ nested: { type: 'text', value: 'x' } }] } })
    expect(() => validateTree(data)).toThrow('/children/0/data/demo.value/0/nested: a node in an opaque object')
    const extension = documentOf({ type: 'block_extension', name: 'demo.widget', version: '1', fallback: [], children: [],
      props: { one: [{ type: 'text', value: 'x' }] } })
    expect(() => validateTree(extension)).toThrow('/children/0/props/one/0: a node in an opaque object')
  })

  it('C2-A-161, C2-A-162: equality compares opaque data and typed metadata', () => {
    const make = (value: string) => documentOf({ ...paragraph('x'), data: { 'demo.value': { value } },
      metadata: { title: [text('title')] } })
    expect(treesEqual(make('a'), make('b'))).toBe(false)
    expect(treesEqual(make('a'), make('a'))).toBe(true)
  })
})
