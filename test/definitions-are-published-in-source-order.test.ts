/*
 * PART 12 §7: "Definitions appear in DOCUMENT ORDER by source position."
 * (carve-js#745.)
 *
 * The two kinds arrive from two places - link reference definitions from the
 * parse, footnotes appended by the serializer - so the published order followed
 * the TABLES rather than the source. A footnote written before a link definition
 * came out after it, and `pos` ran backwards between two adjacent siblings.
 *
 * carve-php had the identical cause (its two collection tables appended in a
 * fixed order) and fixed it the same way, carve-php#902.
 */

import { describe, expect, it } from 'vitest'
import { carveToAstJson } from '../src/index.js'

/** The published document children, as `[type, startLine]` pairs. */
const order = (source: string): Array<[string, number | undefined]> =>
  carveToAstJson(source).children.map((c) => [c.type, c.pos?.startLine])

describe('hoisted definitions', () => {
  it('are published in source order across both kinds', () => {
    // The footnote is written on line 1 and the link definition on line 2.
    expect(order('[^a]: note\n  [r]: /u\n\nsee[^a] and [t][r]\n')).toEqual([
      ['paragraph', 4],
      ['footnote', 1],
      ['link_reference_definition', 2],
    ])
  })

  it('are published in source order when the link definition comes first', () => {
    // The other way round, so the test cannot pass by a fixed kind order.
    expect(order('[r]: /u\n\n[^a]: note\n\nsee[^a] and [t][r]\n')).toEqual([
      ['paragraph', 5],
      ['link_reference_definition', 1],
      ['footnote', 3],
    ])
  })

  it('keeps several definitions of one kind in source order', () => {
    expect(order('[a]: /1\n\n[b]: /2\n\nsee [x][a] and [y][b]\n')).toEqual([
      ['paragraph', 5],
      ['link_reference_definition', 1],
      ['link_reference_definition', 3],
    ])
  })

  it('never runs pos backwards between adjacent definitions', () => {
    // The invariant behind the rule, stated directly: a writer walking the
    // children in order has to see the lines in the order the author wrote them.
    const lines = order('[^a]: note\n  [r]: /u\n\nsee[^a] and [t][r]\n')
      .filter(([type]) => type === 'footnote' || type === 'link_reference_definition')
      .map(([, line]) => line ?? 0)
    expect(lines).toEqual([...lines].sort((a, b) => a - b))
  })

  it('leaves a document with one definition alone', () => {
    expect(order('[r]: /u\n\nsee [t][r]\n')).toEqual([
      ['paragraph', 3],
      ['link_reference_definition', 1],
    ])
  })
})
