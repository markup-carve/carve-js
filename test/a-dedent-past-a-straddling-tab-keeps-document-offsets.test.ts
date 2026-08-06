import { describe, expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/**
 * Synthesized residual spaces do not claim source offsets (carve-js#771).
 *
 * Dedenting a line whose indentation ends in a TAB that straddles the content
 * column re-emits the unconsumed columns as spaces, so two markers written at
 * one column reach the nested parse at one column (carve-js#770). Those spaces
 * are not in the source, and the anchor that maps a sub-line back to the
 * document required the sub-line to be a literal SUFFIX of its source line - so
 * the mapping was declined, and declining meant falling back to the sub-lexer's
 * own LOCAL offsets.
 *
 * Local offsets are indistinguishable from document ones downstream: a nested
 * paragraph reported `[0, 1]` inside a list item at `[6, 11]`, so a span sat
 * outside its parent and two siblings overlapped, both PART 12 §4 invariants.
 */
describe('a dedent past a straddling tab', () => {
  const SOURCE = '- a\n    - b\n \t- c\n'

  type Node = { type: string; pos?: { startOffset: number; endOffset: number }; [k: string]: unknown }

  const nodesOf = (root: Node): Array<{ path: string; node: Node }> => {
    const out: Array<{ path: string; node: Node }> = []
    const walk = (n: Node, path: string): void => {
      out.push({ path, node: n })
      for (const key of ['children', 'items']) {
        const kids = (n as Record<string, unknown>)[key]
        if (Array.isArray(kids)) kids.forEach((c, i) => walk(c as Node, `${path}.${key}[${i}]`))
      }
    }
    walk(root, '$')

    return out
  }

  it('anchors every node to the document, not to the sub-parse', () => {
    const nodes = nodesOf(carveToAstJson(SOURCE) as unknown as Node)
    // The text nodes are what pin it: `b` and `c` sit at known offsets in the
    // SOURCE, and the local numbering put both at 0.
    const texts = nodes.filter((n) => n.node.type === 'text')
    expect(texts.map((t) => t.node.pos?.startOffset)).toEqual([2, 10, 16])
    expect(SOURCE[10]).toBe('b')
    expect(SOURCE[16]).toBe('c')
  })

  it('keeps every span inside its parent', () => {
    const nodes = nodesOf(carveToAstJson(SOURCE) as unknown as Node)
    for (const { path, node } of nodes) {
      if (!node.pos) continue
      const parentPath = path.replace(/\.[a-z]+\[\d+\]$/, '')
      const parent = nodes.find((n) => n.path === parentPath)?.node
      if (!parent?.pos || parent === node) continue
      expect(node.pos.startOffset, `${path} starts before ${parentPath}`).toBeGreaterThanOrEqual(
        parent.pos.startOffset,
      )
      expect(node.pos.endOffset, `${path} ends after ${parentPath}`).toBeLessThanOrEqual(
        parent.pos.endOffset,
      )
    }
  })

  it('still places the uniform spelling of the same document', () => {
    // The control. Spaces-only indentation was always a literal suffix, so it
    // never took the path above - and it must keep the offsets it had.
    const nodes = nodesOf(carveToAstJson('- a\n    - b\n    - c\n') as unknown as Node)
    const texts = nodes.filter((n) => n.node.type === 'text')
    expect(texts.map((t) => t.node.pos?.startOffset)).toEqual([2, 10, 18])
  })
})
