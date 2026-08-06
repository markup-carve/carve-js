import { describe, expect, it } from 'vitest'
import { parse, renderCarve, toAstJson } from '../src/index.js'

/*
 * An emptied `<dd>` still publishes a position.
 *
 * A description whose ONLY content is a link reference or footnote definition
 * loses it: PART 12 §7 hoists both to the document root, and the description is
 * left with no children. This engine derived a `definition_description`'s span
 * from its children, so it then published no `pos` at all - the one thing in the
 * document a consumer resolving a click could not land on, and there is nothing
 * else at that offset to land on instead (markup-carve/carve-js#813).
 *
 * THIS IS NOT PART 12 §4's EXEMPTION. §4 exempts a node the producer
 * REASSEMBLED, because its value is not a slice of the source at any offset.
 * These lines are contiguous, unmoved and still in the source, and
 * docs/ast-json.md:116-117 narrows the exemption to "nodes that *cannot* be
 * placed, not nodes that have not been placed yet".
 *
 * The span is MARKUP-INCLUSIVE - it starts at the `:  ` marker, per the
 * markup-carve/carve#913 ruling - and it is byte-identical to what carve-php
 * publishes for the same document.
 */

const descriptions = (source: string) => {
  const found: Array<{ pos?: { startOffset?: number; endOffset?: number }; children: unknown[] }> =
    []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(walk)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    if (record['type'] === 'definition_description') {
      found.push(record as never)
    }
    Object.values(record).forEach(walk)
  }
  walk(toAstJson(parse(source)))
  return found
}

/** The source text a description's span selects, or null when it has none. */
const slice = (source: string) =>
  descriptions(source).map((d) =>
    d.pos?.startOffset === undefined || d.pos.endOffset === undefined
      ? null
      : source.slice(d.pos.startOffset, d.pos.endOffset),
  )

describe('a description emptied by hoisting keeps its place', () => {
  // Both constructs PART 12 §7 hoists out of a description. Widened past the
  // link reference definition the ticket names: the footnote definition empties
  // a `<dd>` the same way and is the corpus `-2` variant.
  const emptying: Array<[string, string]> = [
    ['link reference definition', ':: term\n:  [r]: /u\n\nsee [t][r]\n'],
    ['footnote definition', ':: term\n:  [^f]: x\n\nsee[^f]\n'],
  ]

  for (const [label, source] of emptying) {
    it(`publishes a span covering the authored line: ${label}`, () => {
      const found = descriptions(source)

      expect(found).toHaveLength(1)
      expect(found[0]!.children).toHaveLength(0)
      expect(found[0]!.pos).toBeDefined()
    })

    it(`and the span slices to exactly that line: ${label}`, () => {
      // Asserted as the SLICE, not as a pair of numbers. The trap this whole
      // family keeps re-finding is a check that asserts a property the bug
      // preserves - carve-php's `[0,1]` and the other engines' `[4,5]` both
      // slice to "*", so "the span slices to plausible text" passed for both.
      // Here the slice IS the claim: the marker line, marker included.
      expect(slice(source)).toEqual([source.split('\n')[1]])
    })
  }

  it('places every description when several are emptied in one entry', () => {
    // Each description gets its OWN recorded extent, so a fix that stamped one
    // span onto the whole entry would put both `<dd>`s at the same offset.
    const source = ':: term\n:  [r]: /u\n:  [q]: /v\n\nsee [t][r]\n'

    expect(slice(source)).toEqual([':  [r]: /u', ':  [q]: /v'])
  })

  it('places an emptied description beside a placed one', () => {
    // The derived span still wins where there IS content, so the two paths have
    // to coexist inside one entry.
    const source = ':: term\n:  [r]: /u\n:  body\n\nsee [t][r]\n'

    expect(slice(source)).toEqual([':  [r]: /u', 'body'])
  })

  it('covers every line the description consumed, not just its marker line', () => {
    // A second definition on a CONTINUATION line empties the same description,
    // so the emptied case is not always one line. A span recorded from the
    // marker line alone would stop at the first newline and report a `<dd>`
    // shorter than the one the author wrote.
    const source = ':: term\n:  [r]: /u\n   [q]: /v\n\nsee [t][r] [t][q]\n'

    expect(slice(source)).toEqual([':  [r]: /u\n   [q]: /v'])
  })

  it('keeps an interior blank line inside the span', () => {
    // The blank is absorbed as a paragraph separator because a later line still
    // continues the body, so it is INTERIOR and belongs to the description. A
    // fix that stopped the span at the first blank would cut the second
    // definition out of a `<dd>` that owns it.
    const source = ':: term\n:  [r]: /u\n\n   [q]: /v\n\nsee [t][r]\n'

    expect(slice(source)).toEqual([':  [r]: /u\n\n   [q]: /v'])
  })

  it('CONTROL: a description whose content does not hoist is unchanged', () => {
    // The span is derived from children here and covers the content alone. It
    // must not start moving to the marker as a side effect - whether it SHOULD
    // is markup-carve/carve#913's extent question, settled for every node type
    // at once and not one at a time here.
    expect(slice(':: term\n:  body\n\nx\n')).toEqual(['body'])
  })

  it('CONTROL: an abbreviation definition does not empty a description', () => {
    // It is recognized at document level only, so inside a `<dd>` it stays
    // ordinary content and the derived span still applies. No mutation of this
    // change can move this row; it is here because the ticket's mechanism is
    // "PART 12 §7 hoisting" and this is the §7 construct that does not.
    expect(slice(':: term\n:  *[HTML]: HyperText\n\nHTML\n')).toEqual(['*[HTML]: HyperText'])
  })
})

describe('the recorded extent does not reach the writer', () => {
  it('does not escalate a definition list to conservative escaping', () => {
    // `renderCarve` renders minimally, re-parses, and escalates to conservative
    // escaping when the two trees differ (PART 11 §4). The comparison drops
    // positions BY KEY NAME, so a positions field called anything else is
    // compared - and escaping a character shifts every offset after it, so the
    // two trees always differ and every definition list escalates.
    //
    // That is exactly the `footnoteDefPos` defect carve#478 traced 12 of 14
    // cross-engine writer diffs to, reproduced here by adding a second such
    // field. The corpus round-trip caught it; this names it.
    expect(renderCarve(parse(':: color\n:  The visual property of objects.\n'))).toBe(
      ':: color\n:  The visual property of objects.\n',
    )
  })

  it('and still does not, when the description is the emptied kind', () => {
    // The emptied description is written back with its definition on it
    // (markup-carve/carve#805), so this is the path that reads the new field
    // AND the writer's escape decision in the same document.
    const source = ':: term\n:  [r]: /u\n\nsee [t][r]\n'

    expect(renderCarve(parse(source))).toBe(source)
  })
})

describe('the recorded extent is in the same unit as every other span', () => {
  // PART 12 §4 pins the unit at CODEPOINTS. The scanner counts UTF-16 code
  // units, and the two agree across the whole Basic Multilingual Plane - so the
  // only fixture that can tell them apart is one carrying a surrogate pair,
  // which is why nothing here ever caught this.
  //
  // The conversion recognized a position by the KEY `pos`, so a position stored
  // under any other name kept UTF-16 offsets while its neighbours were
  // converted: one document, two units.
  const EMOJI = '\u{1F600}'
  const codepoints = (source: string, from: number, to: number) =>
    [...source].slice(from, to).join('')

  it('an emptied description is placed in codepoints, not code units', () => {
    const source = `${EMOJI}\n\n:: term\n:  [r]: /u\n\nsee [t][r]\n`
    const pos = descriptions(source)[0]!.pos!

    expect(codepoints(source, pos.startOffset!, pos.endOffset!)).toBe(':  [r]: /u')
  })

  it('and a footnote definition is too, which it was not before', () => {
    // NOT this ticket's field, and wrong on main for the same reason:
    // `footnoteDefPos` is a root-level MAP of positions, so the key-based
    // conversion never reached it. One emoji ahead of the definition put its
    // published span one codepoint late.
    const astral = `${EMOJI}\n\n[^f]: body\n\nsee[^f]\n`
    const plain = `x\n\n[^f]: body\n\nsee[^f]\n`
    const spanOf = (source: string) => {
      const found: Array<{ pos: { startOffset: number; endOffset: number } }> = []
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) return void node.forEach(walk)
        if (typeof node !== 'object' || node === null) return
        const record = node as Record<string, unknown>
        if (record['type'] === 'footnote' && record['pos']) found.push(record as never)
        Object.values(record).forEach(walk)
      }
      walk(toAstJson(parse(source)))
      return found[0]!.pos
    }

    expect(codepoints(astral, spanOf(astral).startOffset, spanOf(astral).endOffset)).toBe(
      '[^f]: body\n',
    )
    // The astral document and the plain one differ by one CODEPOINT before the
    // definition, so their spans must be equal - the emoji is one codepoint and
    // `x` is one codepoint. Under the old conversion they differed by one,
    // which is the whole defect stated as a comparison.
    expect(spanOf(astral)).toEqual(spanOf(plain))
  })
})

describe('the emptied span is contained by its list and contains nothing', () => {
  it("sits inside the definition_list's own span", () => {
    // markup-carve/carve#913 makes containment part of the ruling: a parent's
    // span must contain every child's. An invented span is easy to write and
    // this is the cheap check that it was not.
    const source = ':: term\n:  [r]: /u\n\nsee [t][r]\n'
    const ast = toAstJson(parse(source)) as unknown as {
      children: Array<{ type: string; pos?: { startOffset: number; endOffset: number } }>
    }
    const list = ast.children.find((c) => c.type === 'definition_list')!
    const dd = descriptions(source)[0]!

    expect(list.pos!.startOffset).toBeLessThanOrEqual(dd.pos!.startOffset!)
    expect(list.pos!.endOffset).toBeGreaterThanOrEqual(dd.pos!.endOffset!)
  })
})
