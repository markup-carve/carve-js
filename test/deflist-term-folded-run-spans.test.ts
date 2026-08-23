import { describe, expect, it } from 'vitest'

import { carveToHtml, parse, toAstJson } from '../src/index.js'

/*
 * A verbatim run folded into a definition term ends where its VALUE ends.
 *
 * markup-carve/carve-js#1145. On
 * `268-trailing-whitespace-on-a-content-line-is-dropped-13.crv` all three
 * engines published the identical value `"a\nb"` and carve-js alone spanned the
 * `code` node one codepoint wider - `endOffset` 8 where carve-rs and carve-php
 * give 7 - covering the trailing space the content rule drops.
 *
 * The cause was NOT in the run. It was the term's line collection: the marker
 * line dropped its own trailing run and a FOLDED continuation did not, so the
 * text the inline scanner measured against still carried the space. The
 * unclosed run then correctly ran to the end of that text, and the end of that
 * text was one column too far right.
 *
 * That is why the coverage here asserts SPANS. The same defect published
 * `<dt>a\nb </dt>` for a plain term, which any HTML assertion catches - but on
 * THIS document the run's own value strip hides it, every renderer prints the
 * same bytes, and only a position comparison can fail. The render rows below
 * are named as controls for exactly that reason.
 *
 * Measured as the SLICE the span selects rather than as a pair of numbers: a
 * span that is merely present proves nothing.
 */

interface Placed {
  type: string
  value?: string
  slice: string | null
}

/** Every positioned inline of the document, with the source its span selects. */
const inlines = (source: string): Placed[] => {
  const out: Placed[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    const type = record['type']
    if (type === 'code' || type === 'text' || type === 'soft_break' || type === 'math') {
      const pos = record['pos'] as { startOffset?: number; endOffset?: number } | undefined
      out.push({
        type: type as string,
        value: (record['value'] ?? record['content']) as string | undefined,
        slice:
          pos?.startOffset === undefined || pos.endOffset === undefined
            ? null
            : source.slice(pos.startOffset, pos.endOffset),
      })
    }
    Object.values(record).forEach(walk)
  }
  walk(toAstJson(parse(source)))

  return out
}

/** The `pos` of the first `code` node, as published on the wire. */
const codePos = (source: string): Record<string, number> | undefined => {
  let found: Record<string, number> | undefined
  const walk = (node: unknown): void => {
    if (found) return
    if (Array.isArray(node)) return void node.forEach(walk)
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    if (record['type'] === 'code' && record['pos']) {
      found = record['pos'] as Record<string, number>

      return
    }
    Object.values(record).forEach(walk)
  }
  walk(toAstJson(parse(source)))

  return found
}

describe('an unclosed verbatim run folded into a definition term', () => {
  // The corpus document, spelled out. Line 2 is `b` followed by one space.
  const TICKET = ':: `a\nb \n:  d\n'

  it('ends its span after the last codepoint it owns', () => {
    expect(inlines(TICKET)).toEqual([
      { type: 'code', value: 'a\nb', slice: '`a\nb' },
      { type: 'text', value: 'd', slice: 'd' },
    ])
  })

  it('publishes the offsets and columns carve-rs and carve-php publish', () => {
    // Both numbers, not only the offset: the column moved with it (3 -> 2), and
    // columns are counted in CODEPOINTS on this line.
    expect(codePos(TICKET)).toEqual({
      startLine: 1,
      endLine: 2,
      startColumn: 4,
      endColumn: 2,
      startOffset: 3,
      endOffset: 7,
    })
  })

  it('spans the same whether or not the line carries the run', () => {
    // The one assertion that states the rule directly: the dropped run is not
    // part of the construct, so removing it from the source may not move the
    // span. Before the fix these two documents disagreed by one codepoint.
    expect(codePos(TICKET)).toEqual(codePos(':: `a\nb\n:  d\n'))
  })

  it('does not stop at an INTERIOR folded line that carries a run', () => {
    // The run reaches the end of the term, so a middle line's dropped space
    // leaves the VALUE without it while the span keeps reaching across it - the
    // space is interior to the extent even though it is not content. carve-rs
    // reports the same [3,10) here.
    expect(inlines(':: `a\nb \nc\n:  d\n')[0]).toEqual({
      type: 'code',
      value: 'a\nb\nc',
      slice: '`a\nb \nc',
    })
  })

  it('does the same for a folded math run', () => {
    // `$`-prefixed math takes its unclosed content from the same text, so it
    // was off by the same column.
    expect(inlines(':: $`a\nb \n:  d\n')[0]).toEqual({
      type: 'math',
      value: 'a\nb',
      slice: '$`a\nb',
    })
  })

  it('places a plain folded line at its own text, not one column past it', () => {
    // The HTML-visible half of the same defect: carve-js published
    // `<dt>a\nb </dt>` here where both other engines publish `<dt>a\nb</dt>`.
    expect(inlines(':: a\nb \n:  d\n')).toEqual([
      { type: 'text', value: 'a', slice: 'a' },
      { type: 'soft_break', value: undefined, slice: '\n' },
      { type: 'text', value: 'b', slice: 'b' },
      { type: 'text', value: 'd', slice: 'd' },
    ])
  })

  it("ends the TERM where the run ends, for the term's own reason", () => {
    // THIS ROW USED TO PIN THE OPPOSITE, and it was a scope guard rather than a
    // ruling: shrinking the run must not shrink its container, so the term went
    // on covering the dropped space and this asserted `':: `a\nb '`.
    //
    // The container then had to shrink for a reason of its own
    // (markup-carve/carve-js#1349). A term has no closer, so PART 12 §4 ends it
    // at its last placed child, and PART 2's NO TRAILING WHITESPACE clause -
    // which names a definition term - rules the run is not content at all. The
    // guard's point survives: the run's own span is what carve-js#1145 moved,
    // and it is asserted above; the term's end comes from §4, not from the run.
    const list = toAstJson(parse(TICKET)).children[0] as unknown as {
      items: Array<{ type: string; pos?: { startOffset: number; endOffset: number } }>
    }
    const term = list.items.find((item) => item.type === 'definition_term')

    expect(term?.pos && TICKET.slice(term.pos.startOffset, term.pos.endOffset)).toBe(':: `a\nb')
  })

  it('CONTROL: no renderer can see this', () => {
    // The reason the rows above assert spans. On this document the run's own
    // value strip already removed the space, so the HTML was correct while the
    // span was wrong, and it is byte-identical to the document without the
    // space. An assertion on rendered output cannot fail on carve-js#1145.
    expect(carveToHtml(TICKET)).toBe(carveToHtml(':: `a\nb\n:  d\n'))
    expect(carveToHtml(TICKET)).toContain('<dt><code>a\nb</code></dt>')
  })

  it('CONTROL: a term with no folded line was already right', () => {
    // Green before the fix and after it. The marker line always dropped its own
    // run, so no mutation of this change can break this row.
    expect(inlines(':: `a \n:  d\n')[0]).toEqual({ type: 'code', value: 'a', slice: '`a' })
  })

  it('CONTROL: a paragraph was already right', () => {
    // The same unclosed run outside a term. The paragraph path has dropped the
    // run on every line since carve#926, which is why this shape never showed
    // up in the divergence panel.
    expect(inlines('x `a\nb \n')[0]).toEqual({ type: 'text', value: 'x ', slice: 'x ' })
    expect(inlines('x `a\nb \n')[1]).toEqual({ type: 'code', value: 'a\nb', slice: '`a\nb' })
  })
})
