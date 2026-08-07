import { describe, expect, it } from 'vitest'

import { carveToHtml } from '../src/index.js'

/**
 * A REFERENCE DEFINITION'S TWO METADATA SLOTS TAKE EXACTLY ONE SPACE
 * (markup-carve/carve#912, corpus category 265).
 *
 * `reference_definition = '[', reference_label, ']', ':', space,
 * link_destination, [link_title], [space, attributes], newline` reaches its
 * title through `link_title = space, ...` and its attribute block through
 * `[space, attributes]`. Both are a bare `space` - one character - and this
 * engine read a RUN at both, as carve-php, carve-rs and the executable spec
 * all did.
 *
 * The corpus pins the two-space case and its one-space control for each slot.
 * What it does not pin is the mixed runs, which is where a rule about a run
 * written as a rule about ONE END goes wrong: `<TAB><SP>` passes a check on the
 * character nearest the brace, and `<SP><TAB>` passes a check on the one before
 * it. Both spellings have been shipped in this org, in three languages, on one
 * day. The attribute slot's guard tests both ends, and these assert it.
 */
describe("a reference definition's title slot takes exactly one space", () => {
  const doc = (def: string): string => `${def}\n\n[a][]\n`

  it('takes the title on exactly one space', () => {
    expect(carveToHtml(doc('[a]: /u "T"'))).toBe('<p><a href="/u" title="T">a</a></p>')
  })

  it("takes a single-quoted title too - link_title's other alternative", () => {
    expect(carveToHtml(doc("[a]: /u 'T'"))).toBe('<p><a href="/u" title="T">a</a></p>')
  })

  for (const [name, sep] of [
    ['a run of two spaces', '  '],
    ['a tab', '\t'],
    ['a space then a tab', ' \t'],
    ['a tab then a space', '\t '],
  ] as const) {
    it(`is still a definition, without the title, on ${name}`, () => {
      // The line does not stop being a definition here: `reference_definition`
      // is not yet anchored at end of line, so the rejected run falls into the
      // tail the pattern ignores. carve#911 anchors it, at which point this
      // whole line becomes prose - which is why the assertion is on the TITLE
      // being absent rather than on the exact fallback.
      expect(carveToHtml(doc(`[a]: /u${sep}"T"`))).not.toContain('title="T"')
    })
  }
})

describe("a reference definition's attribute slot takes exactly one space", () => {
  const doc = (def: string): string => `${def}\n\n[a][]\n`

  it('attaches the block on exactly one space', () => {
    expect(carveToHtml(doc('[a]: /u {.c}'))).toBe('<p><a href="/u" class="c">a</a></p>')
  })

  it('attaches it after a title, where one space still separates the two', () => {
    expect(carveToHtml(doc('[a]: /u "T" {.c}'))).toBe('<p><a href="/u" title="T" class="c">a</a></p>')
  })

  for (const [name, sep] of [
    ['a run of two spaces', '  '],
    ['a run of three spaces', '   '],
    ['a tab', '\t'],
    ['a space then a tab', ' \t'],
    ['a tab then a space', '\t '],
  ] as const) {
    it(`does not attach the block on ${name}`, () => {
      expect(carveToHtml(doc(`[a]: /u${sep}{.c}`))).not.toContain('class="c"')
    })
  }

  for (const [name, sep] of [
    ['a no-break space then the space', '\u00a0 '],
    ['a thin space then the space', '\u2009 '],
    ['a space, a no-break space, then the space', ' \u00a0 '],
  ] as const) {
    it(`still attaches the block on ${name}`, () => {
      // Codex review read the guard as too narrow here and asked for
      // `\\p{White_Space}` instead of space-and-tab, on the ground that a
      // destination ENDS at Unicode whitespace, so this is a two-character
      // separator. Measured against the executable spec before complying, and
      // it is not: the oracle spells this slot `/[ \\t]*$/` on the text before
      // the brace and requires that run to equal one space, so a no-break space
      // sitting outside the run does not lengthen it. Widening here would have
      // made this engine the only one to reject these three.
      //
      // The character is not lost either - it stays in the tail the definition
      // ignores, exactly as the run before the DESTINATION is skipped by
      // `\\p{White_Space}*` on the same line.
      expect(carveToHtml(doc(`[a]: /u${sep}{.c}`))).toContain('class="c"')
    })
  }

  it('still glues the braces to the destination on NO space at all', () => {
    // The zero-space case is a different outcome from the two-space one, and
    // deliberately so: whitespace is what ENDS a destination, so with none the
    // braces are simply read as part of it. Left as a control because a guard
    // that rejected this too would be rejecting the wrong thing.
    expect(carveToHtml(doc('[a]: /u{.c}'))).toContain('href="/u{.c}"')
  })
})
