import { describe, expect, it } from 'vitest'
import { parse } from '../src/index.js'

/*
 * A CONTAINER ENDS AT ITS LAST PLACED CHILD (PART 12 §4,
 * markup-carve/carve#1522 and markup-carve/carve#1524).
 *
 * A list and a block quote have no closer, so their extent came from the lines
 * they CONSUMED - and a container consumes lines whose content ends up
 * somewhere else. Two ways it did:
 *
 *   A definition written at an item's content column is collected and hoisted
 *   to the document (§7), so it becomes the list's SIBLING. The list went on
 *   covering it, and offsets 5..14 of `- a\n\n  [r]: /u` were claimed by two
 *   nodes at once - which is exactly what §4's sibling-overlap prohibition
 *   exists to prevent, and carve-lsp is the consumer that cannot answer it.
 *
 *   An attribute block that attaches to nothing yields no child at all, and §4
 *   excludes it by name: "a following line terminator, blank line, or
 *   unattached attribute block does not [belong] and is excluded".
 *
 * NOTHING CAUGHT EITHER, because all three engines did the same thing and the
 * spec repository's three-way span panel compares engines against each other.
 * The check that can fail on it reads the SOURCE instead, and lives in
 * scripts/spec/ast-positions.mjs.
 */

type Pos = { startOffset?: number; endOffset?: number }

const spans = (source: string): Array<[string, number, number]> => {
  const out: Array<[string, number, number]> = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return node.forEach(walk)
    if (!node || typeof node !== 'object') return
    const n = node as { type?: string; pos?: Pos }
    if (typeof n.type === 'string' && n.pos?.startOffset !== undefined) {
      out.push([n.type, n.pos.startOffset, n.pos.endOffset!])
    }
    for (const [key, value] of Object.entries(node)) {
      if (key === 'pos') continue
      walk(value)
    }
  }
  walk(parse(source))
  return out
}

const spanOf = (source: string, type: string, nth = 0): [number, number] => {
  const found = spans(source).filter(([t]) => t === type)
  const hit = found[nth]
  if (!hit) throw new Error(`no ${type} #${nth} in ${JSON.stringify(source)}`)
  return [hit[1], hit[2]]
}

describe('a container ends at its last placed child', () => {
  it('a list stops before the definition hoisted out of it', () => {
    const source = '- a\n\n  [r]: /u\n'
    // The list used to end at 14, which is where the definition ends.
    expect(spanOf(source, 'list')).toEqual([0, 3])
    expect(spanOf(source, 'list_item')).toEqual([0, 3])
    // The definition keeps the span it was written at, and the two no longer
    // overlap: offset 8 resolves to one node.
    expect(spanOf(source, 'link_reference_definition')).toEqual([5, 14])
  })

  it('a block quote stops before a definition hoisted out of it', () => {
    const source = '> a\n> [r]: /u\n'
    const [, quoteEnd] = spanOf(source, 'block_quote')
    const [defStart] = spanOf(source, 'link_reference_definition')
    expect(quoteEnd).toBeLessThanOrEqual(defStart)
  })

  it('a list stops before an unattached attribute block', () => {
    const source = '- a\n  {.x}\ntail\n'
    // The list used to end at 10, covering `{.x}` - which attaches to no block,
    // so nothing in the list owns it.
    expect(spanOf(source, 'list')).toEqual([0, 3])
  })

  it('a list stops before the line terminator that ended its last item', () => {
    // The blank-run half, filed separately as markup-carve/carve-js#1304 and
    // subsumed here: a container that must stop at its last placed child cannot
    // reach into a trailing blank run at all.
    expect(spanOf('- a\n\n\n', 'list')).toEqual([0, 3])
    expect(spanOf('- a\n', 'list')).toEqual([0, 3])
  })

  it('a container a collected definition emptied spans its own markup', () => {
    // The addendum to the ruling: "ends at its last placed child" is silent
    // where there is none, and the inner item here has none - the definition
    // that was its only content hoisted away (markup-carve/carve-rs#1233).
    // Zero width was rejected, because it discards the marker the author typed
    // and is a shape every consumer has to special-case.
    const source = '* * [d]: u\n :\n'
    expect(spanOf(source, 'list', 1)).toEqual([2, 4])
    expect(spanOf(source, 'list_item', 1)).toEqual([2, 4])
  })

  it('a container with children is unchanged', () => {
    // The rule has to be the reason the spans moved, not the documents.
    expect(spanOf('- a\n- b', 'list')).toEqual([0, 7])
    expect(spanOf('> a\n> b', 'block_quote')).toEqual([0, 7])
    // And a container that DOES have a closer still ends at it.
    expect(spanOf('::: n\na\n:::\n', 'admonition')).toEqual([0, 11])
  })
})
