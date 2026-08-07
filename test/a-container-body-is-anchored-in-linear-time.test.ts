import { describe, it, expect } from 'vitest'
import { parse, carveToHtml } from '../src/index.js'
import { expectScansLinearly, perfIt } from './helpers/scaling.js'

/**
 * `attachDocumentOffsets` inverts the parent's line map so a sub-lexer's lines
 * can be charged to their DOCUMENT offsets. That inversion walks every line of
 * the PARENT, and it was rebuilt for every child, so a container-dense document
 * paid one full parent walk per container: an ordinary 16,000-item bullet list
 * took ~18 s where 0.1.2 took ~82 ms (markup-carve/carve-js#885).
 *
 * It is not behind the `positions` parse option, so a plain
 * `carveToHtml(untrustedInput)` paid it - which is what made an ordinary long
 * list a denial of service rather than merely slow.
 *
 * The map is a function of the parent alone, so it is now built once per parent
 * and shared. These are the two halves of that claim: the offsets a shared map
 * produces are the ones a per-child map produced, and the cost per byte no
 * longer grows with the document.
 */

const textNodes = (node: unknown): Array<Record<string, any>> => {
  const out: Array<Record<string, any>> = []
  const walk = (n: any): void => {
    if (!n || typeof n !== 'object') return
    if (n.type === 'text') out.push(n)
    for (const key of ['children', 'items', 'cells', 'rows']) {
      if (Array.isArray(n[key])) n[key].forEach(walk)
    }
  }
  walk(node)
  return out
}

describe('a container body is anchored from a map shared by its siblings', () => {
  /**
   * SIBLINGS UNDER ONE PARENT are what the sharing changes: the second child
   * now reads a map the first built. Each shape puts several containers under
   * the same parent, and every text node has to slice back to the source it
   * names - a stale or mis-shared map lands on a neighbouring line, which the
   * slice catches.
   */
  const cases: Record<string, string> = {
    'sibling list items': '- item one\n- item two\n- item three\n',
    'sibling quotes': '> first quote\n\n> second quote\n\n> third quote\n',
    'sibling admonitions': '::: note\nfirst body\n:::\n\n::: tip\nsecond body\n:::\n',
    'a list nested in each of two quotes': '> - alpha\n> - beta\n\n> - gamma\n> - delta\n',
    // The `+` continuation is the shape the per-line map exists for: it splices
    // a flush-left block into a quote body, so several sub-lines carry the same
    // number and the map has to hold ALL indices per number (carve-js#462).
    'a continued quote beside a plain one':
      '> quoted head\n+\nattached tail\n\n> another quote\n',
    'a continued quote holding a list':
      '> quoted head\n+\n- spliced item\n- second item\n\n> plain neighbour\n',
  }

  for (const [label, src] of Object.entries(cases)) {
    it(`slices back to the source: ${label}`, () => {
      const nodes = textNodes(parse(src))
      expect(nodes.length).toBeGreaterThan(0)
      for (const node of nodes) {
        expect(node.pos, `${label}: a text node has no pos`).toBeDefined()
        expect(src.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
      }
    })
  }

  it('anchors the hundredth sibling exactly as it anchors the first', () => {
    // The parent walk used to happen per child, so nothing distinguished child
    // 1 from child 100. Under a shared map they read the same object, and a map
    // that were built for the first child alone would misplace the hundredth.
    const src = Array.from({ length: 100 }, (_, i) => `- item ${i}`).join('\n') + '\n'
    const nodes = textNodes(parse(src))

    expect(nodes).toHaveLength(100)
    for (const node of nodes) {
      expect(src.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
    }
  })

  perfIt('parses a flat bullet list in linear time', () => {
    // 2,000 -> 8,000 rather than the helper's default 12,500 -> 50,000: the
    // pre-fix path took ~3.6 s at 8,000 items, so the default sizes would have
    // spent minutes proving a point 8,000 already makes. Pre-fix this reads
    // ~4.8x per byte; the guard trips at 2.0.
    expectScansLinearly((input) => void carveToHtml(input), '- x\n', {
      label: 'flat bullet list',
      smallRepeats: 2000,
    })
  })

  perfIt('parses a run of colon fences in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), ':::\n', {
      label: 'colon fence run',
      smallRepeats: 2000,
    })
  })

  perfIt('parses a run of quoted lines in linear time', () => {
    expectScansLinearly((input) => void carveToHtml(input), '> x\n\n', {
      label: 'quoted line run',
      smallRepeats: 2000,
    })
  })
})
