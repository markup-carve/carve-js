import { describe, expect, it } from 'vitest'

import { parse, toAstJson } from '../src/index.js'

/*
 * A trailing space on ONE line of a line block does not unplace the STANZA.
 *
 * PART 12 §4 exempts a node the producer REASSEMBLED, because its value is not
 * a slice of the source at any offset. A line block rewrites the whitespace it
 * preserves to a sentinel, one per column, precisely so that exemption is not
 * needed: every character keeps the offset it came from and the stanza is still
 * anchorable.
 *
 * The alignment test for that was a LENGTH COMPARISON against the source line,
 * and it ran AFTER the trailing-whitespace drop (PART 2; markup-carve/carve#926)
 * had already shortened the expansion. So a single trailing space - a
 * ONE-COLUMN run, the only kind that rule drops - read as "the offsets no
 * longer line up", and the whole stanza was parsed unanchored. Every inline in
 * it lost its position, including ones on OTHER lines that nothing had touched.
 *
 * Dropping a run at the END of a line moves nothing: what remains sits at the
 * offset it came from, and the newline after it is placed from line geometry
 * rather than from this text. A TAB is the real unanchoring case and still is -
 * it expands to up to four sentinels and shifts everything after it.
 *
 * Measured as the SLICE the span selects, not as a pair of numbers: a span that
 * is merely present proves nothing, and this whole family of defects is found by
 * asking what the offsets actually point at.
 */

interface Placed {
  type: string
  value?: string
  slice: string | null
}

/** Every inline of the first stanza, with the source its span selects. */
const inlines = (source: string): Placed[] => {
  const out: Placed[] = []
  const walk = (node: unknown): void => {
    if (Array.isArray(node)) return void node.forEach(walk)
    if (typeof node !== 'object' || node === null) return
    const record = node as Record<string, unknown>
    const type = record['type']
    if (type === 'text' || type === 'hard_break') {
      const pos = record['pos'] as { startOffset?: number; endOffset?: number } | undefined
      out.push({
        type: type as string,
        value: record['value'] as string | undefined,
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

describe('a line block keeps its positions across a dropped trailing run', () => {
  // A preserved column is the U+E000 sentinel, not a space, so a two-column run
  // is CONTENT and shows up in both the value and the slice. Spelled out here
  // because it is invisible in a failure diff otherwise.
  const NBSP = '\ue000'

  it('places both lines when the LAST one carries a trailing space', () => {
    // The corpus document, spelled out: markup-carve/carve#961 reported this as
    // `2x missing pos on "text"` in
    // 268-trailing-whitespace-on-a-content-line-is-dropped-12.crv, and NEITHER
    // of the two is on the line the dropped space is on.
    const source = '::: |\nabc  \ndef \n:::\n'

    expect(inlines(source)).toEqual([
      { type: 'text', value: `abc${NBSP}${NBSP}`, slice: 'abc  ' },
      { type: 'hard_break', value: undefined, slice: '\n' },
      { type: 'text', value: 'def', slice: 'def' },
    ])
  })

  it('places both lines when the FIRST one carries the trailing space', () => {
    // The drop is not specific to the final line - PART 2 applies it to every
    // content line - so a fix that special-cased the last one would leave this
    // unanchored. Under the exact-span consensus, the break owns the dropped
    // trailing layout together with the line terminator.
    const source = '::: |\nabc \ndef\n:::\n'

    expect(inlines(source)).toEqual([
      { type: 'text', value: 'abc', slice: 'abc' },
      { type: 'hard_break', value: undefined, slice: ' \n' },
      { type: 'text', value: 'def', slice: 'def' },
    ])
  })

  it('places a three-line stanza where the MIDDLE line carries the run', () => {
    // A middle line is the case where a shortened line could plausibly shift
    // what follows it, since a later line's text sits after it in the joined
    // stanza. It does not: each line is anchored from its own offset.
    const source = '::: |\nabc\ndef \nghi\n:::\n'

    expect(inlines(source).map((i) => i.slice)).toEqual(['abc', '\n', 'def', ' \n', 'ghi'])
  })

  it('CONTROL: a stanza with no trailing run was already placed', () => {
    // Green before the fix and after it. Named as a control rather than
    // presented as proof: no mutation of this change can break this row.
    const source = '::: |\nabc\ndef\n:::\n'

    expect(inlines(source).map((i) => i.slice)).toEqual(['abc', '\n', 'def'])
  })

  it('CONTROL: a two-column trailing run is CONTENT and was already placed', () => {
    // Two or more columns is a medial gap, kept as sentinel content, so the
    // expansion never got shorter and this line never triggered the defect.
    const source = '::: |\nabc  \ndef\n:::\n'

    expect(inlines(source).map((i) => i.slice)).toEqual(['abc  ', '\n', 'def'])
  })

  it('a TAB still unanchors the stanza, which is what §4 is for', () => {
    // The exemption this change must NOT widen. A tab expands to up to four
    // sentinels, so every character after it sits at an offset that is not its
    // own and no honest span exists - PART 12 §4's actual case. If this row ever
    // goes green, the alignment test has stopped testing anything.
    const source = '::: |\n\tabc\ndef \n:::\n'

    expect(
      inlines(source)
        .filter((i) => i.type === 'text')
        .map((i) => i.slice),
    ).toEqual([null, null])
  })

  it('does not change what the document SAYS', () => {
    // This change moved WHERE the trailing run is dropped, not whether it is.
    // PART 2 is normative, and a position fix must not buy a placed node with a
    // space in the output: the one-column run is gone from the value and the
    // two-column run is still the two sentinels it always was.
    expect(inlines('::: |\nabc  \ndef \n:::\n').map((i) => i.value)).toEqual([
      `abc${NBSP}${NBSP}`,
      undefined,
      'def',
    ])
  })
})
