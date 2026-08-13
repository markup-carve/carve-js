import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A table cell pads with a SPACE, and with nothing else.
 *
 * `delimiter_cell`, `header_cell`, `data_cell`, `rowspan_marker` and
 * `colspan_marker` each spell their padding slots `{space}` in
 * `resources/grammar.ebnf`, and PART 7's MARKER SEPARATORS AND PADDING SLOTS
 * decides the terminal by POSITION: a tab is syntax ONLY in a line's leading
 * indentation run. Every one of these slots sits after the row's opening `|`,
 * so every one of them is inline and takes a space (carve#910, carve-js#803).
 *
 * A tab in a padding slot is not a rejection - it stops being padding and
 * becomes ordinary cell CONTENT, staying where it was written. Corpus category
 * 256 pins both ends of all five productions with the tab.
 *
 * WHAT THIS FILE ADDS ON TOP OF THE CORPUS: the slot was implemented with
 * `trimStructural`, which is JavaScript's `\s` minus U+00A0 - so narrowing it
 * to a space moved FOUR MORE CHARACTERS than the tab the ticket named. The
 * corpus states the tab; the rest of the legacy set is pinned here, because
 * "the padding slot takes a space" and "the padding slot takes anything
 * `trimStructural` strips except a tab" are two different rules that agree on
 * every corpus document.
 */

/** Rendered `<td>`/`<th scope="col">` inner texts, in document order. */
const cells = (html: string): string[] =>
  [...html.matchAll(/<t([dh])(?:\s[^>]*)?>([\s\S]*?)<\/t\1>/g)].map((m) => m[2]!)

describe('the padding slot takes a space and not the rest of the legacy set', () => {
  // Every character below is one `trimStructural` used to strip at a cell
  // boundary. The tab is the one the production names; the other four came
  // with it because the slot was spelled as a whitespace CLASS rather than as
  // the terminal the grammar writes.
  const stripped: Array<[string, string]> = [
    ['tab U+0009', '\t'],
    ['vertical tab U+000B', '\v'],
    ['form feed U+000C', '\f'],
    ['en quad U+2000', ' '],
    ['byte order mark U+FEFF', '﻿'],
  ]

  for (const [label, ch] of stripped) {
    it(`stays cell content at the leading slot: ${label}`, () => {
      expect(cells(carveToHtml(`|${ch}a |${ch}b |\n`))).toEqual([`${ch}a`, `${ch}b`])
    })

    it(`stays cell content at the trailing slot: ${label}`, () => {
      // Each end reverts independently, so each end is its own assertion: a
      // fixture carrying the character at BOTH ends cannot tell a half-fix
      // from a whole one.
      expect(cells(carveToHtml(`| a${ch}| b${ch}|\n`))).toEqual([`a${ch}`, `b${ch}`])
    })

    it(`survives a mixed run in both orders: ${label}`, () => {
      // The slot is a RUN, not a first character. Written as "the first
      // character must be a space" the fix passes the `${ch}a` case above and
      // still lets `<SP>${ch}a` through; written as "the LAST character must
      // be a space" it lets `${ch}<SP>a` through instead. Both spellings have
      // been written for real in this org, in three languages, in one day.
      expect(cells(carveToHtml(`| ${ch}a | b |\n`))[0]).toBe(`${ch}a`)
      expect(cells(carveToHtml(`|${ch} a | b |\n`))[0]).toBe(`${ch} a`)
      expect(cells(carveToHtml(`| a ${ch}| b |\n`))[0]).toBe(`a ${ch}`)
      expect(cells(carveToHtml(`| a${ch} | b |\n`))[0]).toBe(`a${ch}`)
    })
  }

  it('CONTROL: a non-breaking space was already content and still is', () => {
    // Not proof of anything - `trimStructural` already excepted U+00A0, so no
    // mutation of this change can move this row. It is here so a later
    // rewrite of the trim cannot quietly drop the exception.
    expect(cells(carveToHtml('| a | b |\n'))).toEqual([
      '&nbsp;a&nbsp;',
      '&nbsp;b&nbsp;',
    ])
  })

  it('CONTROL: one space and two spaces both still pad', () => {
    // markup-carve/carve#912 settles the CARDINALITY of a padding slot
    // elsewhere; this change is about WHICH character, and deliberately leaves
    // a run of spaces trimming as it always has.
    expect(cells(carveToHtml('| a |  b  |\n'))).toEqual(['a', 'b'])
  })
})

describe('each of the five productions loses the tab as padding', () => {
  it('a delimiter cell with a tab is no longer a delimiter cell', () => {
    // The failure here is STRUCTURAL rather than textual: the row promotes no
    // header and assigns no alignment, and the dash run becomes prose that
    // smart typography renders as an em dash.
    const html = carveToHtml('| a | b |\n|\t--- |\t--- |\n| 1 | 2 |\n')

    expect(html).not.toContain('<thead')
    expect(cells(html)).toEqual(['a', 'b', '\t—', '\t—', '1', '2'])
  })

  it('a header cell keeps the tab and stays a header cell', () => {
    // `=` is the tight marker, so the header survives; only the padding after
    // it stops being padding.
    const html = carveToHtml('|=\th |=\ti |\n| 1 | 2 |\n')

    expect(html).toContain('<thead')
    expect(cells(html)).toEqual(['\th', '\ti', '1', '2'])
  })

  it('a rowspan marker beside a tab is content, not a span', () => {
    const html = carveToHtml('| a | b |\n|\t^ | c |\n')

    expect(html).not.toContain('rowspan')
    expect(cells(html)).toEqual(['a', 'b', '\t^', 'c'])
  })

  it('a colspan marker beside a tab is content, not a span', () => {
    const html = carveToHtml('| a | b |\n| c |\t< |\n')

    expect(html).not.toContain('colspan')
    expect(cells(html)).toEqual(['a', 'b', 'c', '\t&lt;'])
  })

  it('a continuation row is a data cell too, and pads the same way', () => {
    // The SECOND producer. A `+` row's fragments are trimmed on their own code
    // path, so narrowing only the standard-row path leaves the continuation
    // path joining the tab away with nothing able to see it - the trap that
    // cost the spec oracle a half-fix.
    expect(cells(carveToHtml('| a | b |\n+\tx | y |\n'))).toEqual(['a \tx', 'b y'])
    expect(cells(carveToHtml('| a | b |\n+ x\t| y\t|\n'))).toEqual(['a x\t', 'b y\t'])
  })

  it('a cell attribute block pads with a space after the closing brace', () => {
    // The attribute-block path trims the remainder separately from the two
    // marker paths, so it is a producer of its own.
    const html = carveToHtml('|{.x}\ta | b |\n')

    expect(html).toContain('class="x"')
    expect(cells(html)).toEqual(['\ta', 'b'])
  })
})
