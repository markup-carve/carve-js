import { describe, expect, it } from 'vitest'
import { parse, toAstJson } from '../src/index.js'

type Span = { startOffset?: number; endOffset?: number }
type Node = { type: string; pos?: Span; children?: Node[]; items?: Node[] }

const wire = (source: string): Node => toAstJson(parse(source)) as unknown as Node

function* walk(node: Node, path = '$'): Generator<[Node, string]> {
  yield [node, path]
  for (const key of ['children', 'items'] as const) {
    for (const [index, child] of (node[key] ?? []).entries()) yield* walk(child, `${path}.${key}[${index}]`)
  }
}

// carve#5013 writes a consumed `+` as a `%%` stand-in, one column wider than the `+`; carve#5157 leaves no node for it.
// Spans must come from the source: no stand-in span, no sibling overlap, every node inside its parent.
describe('a consumed plus keeps an empty host span; a refused tail stops at the last child', () => {
  it('ends a nonempty first item after its child and leaves no stand-in (carve#5246)', () => {
    const list = wire('- a\n+\n- x\n').children![0]!
    expect(list.items!.map((item) => [item.pos?.startOffset, item.pos?.endOffset])).toEqual([[0, 3], [6, 9]])
    expect(list.items![0]!.children!.map((child) => child.type)).toEqual(['paragraph'])
  })

  it.each([
    ['- a\n+\n', [0, 3]],
    ['> +\n', [0, 3]],
    [':: t\n: q\n+\n+\n', [5, 8]],
    [':: t\n: +\n    flush\n', [5, 18]],
    ['﻿- a\n+\n- x\n', [1, 4]],
    ['- a\r\n+\r\n- x\r\n', [0, 3]],
  ])('places the host of %j from the source', (source, [start, end]) => {
    const doc = wire(source)
    expect([...walk(doc)].some(([node]) => node.type === 'comment')).toBe(false)
    const host = [...walk(doc)].find(([node]) => ['list_item', 'block_quote', 'definition_description'].includes(node.type))
    expect(host?.[0].pos && [host[0].pos.startOffset, host[0].pos.endOffset]).toEqual([start, end])
  })

  it.each(['{children=x}\n- a\n+\n', '{definitions=x}\n- a\n+\n'])('reads an attribute key named like a child array in %j', (source) => {
    const list = wire(source).children![0]!
    expect(list.items![0]!.children!.map((child) => child.type)).toEqual(['paragraph'])
  })

  // carve#5145: a list item whose body is only the `+` keeps no stand-in child either.
  it('places an emptied list item from the source', () => {
    const item = (wire('- +\n- b\n').children![0]!).items![0]!
    expect(item.children).toEqual([])
    expect(item.pos && [item.pos.startOffset, item.pos.endOffset]).toEqual([0, 3])
  })

  // carve#5108: a description whose body is only the `+` keeps no stand-in child.
  it('places an emptied description from the source', () => {
    const description = [...walk(wire(':: t\n : +\nl\n: b\n'))].find(([node]) => node.type === 'definition_description')?.[0]
    expect(description?.children).toEqual([])
    expect(description?.pos && [description.pos.startOffset, description.pos.endOffset]).toEqual([6, 9])
  })

  it.each([
    ['[^a]: +\n flush\n\nsee[^a]\n', 'flush'],
    ['- > [^b]: +\npara\n\nr[^b]\n', 'para'],
    ['> - \t- +\nx\n', 'x'],
  ])('keeps a rewritten follower of %j on its own source text', (source, text) => {
    const doc = wire(source)
    const node = [...walk(doc)].find(([n]) => n.type === 'text' && (n as { value?: string }).value === text)?.[0]
    expect(node?.pos && [...source].slice(node.pos.startOffset, node.pos.endOffset).join('')).toBe(text)
  })

  it.each([
    '- a\n+\n- x\n', '1. a\n+\n2. x\n', '- - a\n  +\n  - x\n', '> a\n+\n> b\n',
    '- a\n  - +\n   + y\n', ':: t\n: q\n+\n+\n', '[^n]: - +\np\n\nr[^n]\n',
  ])('keeps the spans of %j disjoint and nested', (source) => {
    for (const [node, path] of walk(wire(source))) {
      // A hoisted footnote sits last in the document's children, so order the spans first.
      const kids = [...(node.children ?? []), ...(node.items ?? [])].filter((kid) => kid.pos !== undefined)
        .sort((x, y) => x.pos!.startOffset! - y.pos!.startOffset!)
      for (const kid of kids) {
        expect(kid.pos!.startOffset!, path).toBeGreaterThanOrEqual(node.pos?.startOffset ?? 0)
        expect(kid.pos!.endOffset!, path).toBeLessThanOrEqual(node.pos?.endOffset ?? source.length)
      }
      for (let k = 1; k < kids.length; k++) expect(kids[k]!.pos!.startOffset!, path).toBeGreaterThanOrEqual(kids[k - 1]!.pos!.endOffset!)
    }
  })
})
