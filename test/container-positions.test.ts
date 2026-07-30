import { describe, it, expect } from 'vitest'
import { parse, lintCarve } from '../src/index.js'

/**
 * Inline positions inside a container used to be measured against the
 * container's STRIPPED text, so they pointed at unrelated source: a text node
 * inside a blockquote reported offsets starting at 0, and `carve lint` reported
 * a column short by the prefix the container removed (#444).
 *
 * Wrong positions are worse than missing ones - a consumer uses the number and
 * lands somewhere else with nothing signalling a problem, which is what PART 12
 * §4's rule against invented values is about.
 *
 * These assert by SLICING THE SOURCE with the reported offsets, so a span that
 * is present but wrong fails.
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

describe('inline positions inside containers', () => {
  const cases: Record<string, string> = {
    blockquote: '# H\n\n> quoted text\n',
    'nested blockquote': '# H\n\n> > deeply quoted\n',
    'list item': '# H\n\n- item one\n- item two\n',
    'nested list': '# H\n\n- outer\n  - inner text\n',
    admonition: '# H\n\n::: note\nbody text\n:::\n',
    'blockquote in a list': '# H\n\n- item\n\n  > quoted inside\n',
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

  it('reports the document column, not the column within the container', () => {
    // `[^nope]` starts at column 13 of `- item with [^nope] here`; before the
    // fix this said 11, short by the `- ` marker.
    const [warning] = lintCarve('# T\n\n- item with [^nope] here\n')
    expect(warning!.line).toBe(3)
    expect(warning!.column).toBe(13)
  })

  it('reports the document column inside a blockquote too', () => {
    const [warning] = lintCarve('# T\n\n> quoted [^nope] here\n')
    expect(warning!.line).toBe(3)
    expect(warning!.column).toBe(10)
  })

  it('maps continuation lines, not just the first line of a block', () => {
    // The scanner walks the container's stripped text, so after the first
    // newline a single base offset drifts by the prefix each following line
    // carries. Per-line anchors are what make this land.
    for (const src of ['# H\n\n> one\n> two\n', '# H\n\n- a\n  b\n', '# H\n\nalpha\nbeta\n']) {
      for (const node of textNodes(parse(src))) {
        expect(src.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
      }
    }
  })

  it('handles a varying prefix width down the same container', () => {
    // `>`, `> ` and `>  ` are all valid, so the prefix is per-line rather than
    // one constant for the block.
    const src = '# H\n\n>one\n> two\n>  three\n'
    for (const node of textNodes(parse(src))) {
      expect(src.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
    }
  })

  it('leaves reconstructed content alone rather than guessing', () => {
    // A line block expands leading whitespace and a table reassembles cells, so
    // neither line is a suffix of its document line and no exact mapping exists.
    // Those keep whatever they had - the point is that nothing here INVENTS a
    // mapping for them. Asserted as "does not throw and still parses", so this
    // test does not pin the wrong values as correct.
    expect(() => parse('::: |\nline one\nline two\n:::\n')).not.toThrow()
    expect(() => parse('| a | b |\n+ cont | more |\n')).not.toThrow()
  })
})
