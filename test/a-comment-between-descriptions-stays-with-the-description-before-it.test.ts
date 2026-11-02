import { describe, expect, it } from 'vitest'
import { carveToAstJson, carveToHtml, parse, renderCarve } from '../src/index.js'

// carve-js#4238: a comment skipped before a later `: ` description belongs to the
// description before it, not the term, so sibling spans keep source order.
type Node = { type: string; pos?: { startOffset?: number; endOffset?: number }; children?: Node[]; items?: Node[] }

const cases: Array<[string, string]> = [
  ['a line comment', ':: term\n: d1\n%% c\n: d2\n'],
  ['a blank before the comment', ':: term\n: d1\n\n%% c\n: d2\n'],
  ['a block comment', ':: term\n: d1\n%%%\nx\n%%%\n: d2\n'],
  ['in a list item', '- :: term\n  : d1\n  %% c\n  : d2\n'],
  ['a run of comments', ':: term\n: d1\n %% c\n%% c\n%% e\n: d2\n'],
]

function firstList(nodes: Node[]): Node {
  for (const node of nodes) {
    if (node.type === 'definition_list') return node
    const inner = [...(node.children ?? []), ...(node.items ?? [])]
    if (inner.length) {
      const found = firstList(inner)
      if (found) return found
    }
  }
  return undefined as unknown as Node
}

describe('a comment between two descriptions', () => {
  for (const [name, source] of cases) {
    it(`stays with the description before it: ${name}`, () => {
      const ast = carveToAstJson(source) as unknown as { children: Node[] }
      const [term, d1, d2] = firstList(ast.children).items!
      expect(term!.children!.some(child => child.type === 'comment')).toBe(false)
      expect(d1!.children!.at(-1)!.type).toBe('comment')
      expect(term!.pos!.endOffset!).toBeLessThanOrEqual(d1!.pos!.startOffset!)
      expect(d1!.pos!.endOffset!).toBeLessThanOrEqual(d2!.pos!.startOffset!)
    })

    it(`is written back in place: ${name}`, () => {
      const written = renderCarve(parse(source))
      expect(carveToHtml(written)).toBe(carveToHtml(source))
      expect(renderCarve(parse(written))).toBe(written)
      expect(written.indexOf('%%')).toBeGreaterThan(written.indexOf(': d1'))
    })
  }

  it('the reproduction spans as carve-rs does', () => {
    const ast = carveToAstJson(':: term\n: d1\n%% c\n: d2\n') as unknown as { children: Node[] }
    const spans = firstList(ast.children).items!.map(item => [item.type, item.pos!.startOffset, item.pos!.endOffset])
    expect(spans).toEqual([
      ['definition_term', 0, 7],
      ['definition_description', 8, 17],
      ['definition_description', 18, 22],
    ])
  })
})
