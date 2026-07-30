import { describe, it, expect } from 'vitest'
import { parse } from '../src/index.js'

/**
 * PART 12 §4 requires `pos` on every node except the document root, and forbids
 * emitting one with invented values. Abbreviation expansion splits a text node
 * AFTER parsing, so its fragments had no span at all.
 *
 * These assert by SLICING THE SOURCE with the reported offsets: a span that is
 * present but wrong fails, which "expect(node.pos).toBeDefined()" would not.
 */
describe('abbreviation expansion keeps source positions', () => {
  const src = '*[HTML]: HyperText Markup Language\n\nThe HTML spec and more HTML here.\n'

  const inlines = () => {
    const doc = parse(src)
    const paragraph = doc.children[doc.children.length - 1] as {
      children: Array<Record<string, any>>
    }
    return paragraph.children
  }

  it('gives every fragment a span that slices back to its own text', () => {
    for (const node of inlines()) {
      expect(node.pos, `${node.type} has no pos`).toBeDefined()
      const slice = src.slice(node.pos.startOffset, node.pos.endOffset)
      expect(slice).toBe(node.value ?? node.abbr)
    }
  })

  it('places the abbreviation nodes at the right offsets', () => {
    const abbrs = inlines().filter((n) => n.type === 'abbreviation')
    expect(abbrs).toHaveLength(2)
    // Both occurrences, not just the first: the second fragment's offset is
    // derived from a different position within the same parent text node.
    expect(abbrs.map((a) => a.pos.startOffset)).toEqual([
      src.indexOf('HTML', src.indexOf('\n\n')),
      src.lastIndexOf('HTML'),
    ])
  })

  it('keeps fragments on the parent line, and contiguous', () => {
    const nodes = inlines()
    const line = nodes[0]!.pos.startLine
    for (const node of nodes) {
      expect(node.pos.startLine).toBe(line)
      expect(node.pos.endLine).toBe(line)
    }
    // A split loses nothing: each fragment starts where the previous ended.
    for (let i = 1; i < nodes.length; i++) {
      expect(nodes[i]!.pos.startOffset).toBe(nodes[i - 1]!.pos.endOffset)
    }
  })

  it('derives columns as well as offsets', () => {
    const first = inlines()[0]!
    expect(first.pos.startColumn).toBe(1)
    expect(first.pos.endColumn).toBe(1 + 'The '.length)
  })

  it('leaves a text node with no abbreviation exactly as it was', () => {
    const plain = 'No abbreviations here.\n'
    const node = (parse(plain).children[0] as { children: Array<Record<string, any>> })
      .children[0]!
    expect(plain.slice(node.pos.startOffset, node.pos.endOffset)).toBe(node.value)
  })
})
