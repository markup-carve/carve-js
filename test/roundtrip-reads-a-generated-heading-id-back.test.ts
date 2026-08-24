import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToCarve } from '../src/index.js'

/**
 * `roundtrip` mode's input is THIS ENGINE'S OWN OUTPUT by definition, so a
 * heading id there was GENERATED - and re-emitting it changes the render, since
 * `renderHtml` writes a generated id after every authored attribute and an
 * authored one in the slot it was written in. `{.k}` and `{.k #H}` are
 * therefore two different documents. carve-rs ruled this in carve-rs#1354 and
 * carve-rs#1355; carve-js had no such carve-out and kept the id
 * (markup-carve/carve-js#1459).
 *
 * ## Where this engine actually puts a heading id, measured not assumed
 *
 * Two placements, and only ONE of them is a heading attribute:
 *
 * - A TOP-LEVEL heading is wrapped: `# H` renders `<section id="H"><h1>H</h1>
 *   </section>`, and the `<h1>` carries no id at all. That id belongs to the
 *   SECTION, and the section is an unsupported element the importer unwraps -
 *   it never reaches the heading arm, and the import already comes back as
 *   plain `# H` in every mode.
 * - A heading inside a container - a list item, a quote - is NOT sectioned, so
 *   the id sits on the `<h1>` itself. The same is true at top level under
 *   `sections: false`.
 *
 * So the carve-out belongs on the second placement only, which is also the one
 * markup-carve/carve-js#1459 measured. Covering the `<section>` id here would
 * mean reading a wrapper's attribute as a heading's, which is a different claim
 * about a different element.
 *
 * ## Both halves, and why neither alone is enough
 *
 * POSITION: the id sits after every authored attribute, with only a render
 * annotation (`data-source-line`) allowed to follow it.
 *
 * VALUE: it equals the default slug of the heading's own plain text, or that
 * slug with the `-N` dedup tail `resolveHeadingIds` writes, which starts at 2
 * because the first occurrence takes the bare base.
 *
 * Position alone eats an id an author wrote LAST (`{.k #Other}`); value
 * equality alone cannot tell `{.k}` from an id an author wrote FIRST whose
 * value happens to be the slug (`{#H .k}`). Both controls are below, and each
 * is the one the other half would fail.
 *
 * THE DEFAULT SLUG ONLY, which is the accepted limit `dropDerived` already
 * states for every derived attribute: an importer cannot know which heading-id
 * options the render used, so a value no default equals is indistinguishable
 * from an authored one and keeping it is the safe side.
 */

const modes = ['safe', 'semantic', 'roundtrip'] as const

const written = (html: string) =>
  Object.fromEntries(modes.map((mode) => [mode, htmlToCarve(html, { mode }).value]))

describe('roundtrip mode reads a generated heading id back', () => {
  it('drops the bare slug in roundtrip and keeps it in the other two', () => {
    expect(written('<ul><li>a<h1 class="k" id="H">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {.k #H}\n  # H\n',
      semantic: '- a\n  {.k #H}\n  # H\n',
      roundtrip: '- a\n  {.k}\n  # H\n',
    })
  })

  it('drops the -N dedup form too', () => {
    // `H-2` is what a second `# H` in the same document is given, so it is an
    // id this engine would have produced itself. carve-js kept it in every mode
    // even before markup-carve/carve-js#1416, so this half never agreed with
    // carve-rs by accident.
    expect(written('<ul><li>a<h1 class="k" id="H-2">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {.k #H-2}\n  # H\n',
      semantic: '- a\n  {.k #H-2}\n  # H\n',
      roundtrip: '- a\n  {.k}\n  # H\n',
    })
  })

  it('leaves a heading that carried nothing else with no attribute block', () => {
    // The id was the whole of `attrs`, so dropping it must leave the heading
    // with no attributes rather than an empty `{}` line.
    expect(written('<ul><li>a<h1 id="H">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {#H}\n  # H\n',
      semantic: '- a\n  {#H}\n  # H\n',
      roundtrip: '- a\n  # H\n',
    })
  })

  it('reads past the render annotation that is allowed to follow the id', () => {
    // `data-source-line` is emitted LAST on purpose, so an id in front of it is
    // still in the generated position. The annotation ITSELF is an ordinary
    // kept attribute on the way back in - carve-rs writes the same line - and
    // this test is about the id in front of it, not about that.
    expect(written('<ul><li>a<h1 class="k" id="H" data-source-line="4">H</h1></li></ul>').roundtrip).toBe(
      '- a\n  {.k data-source-line=4}\n  # H\n',
    )
  })

  it('KEEPS an id an author wrote last, whose value is not the slug', () => {
    // THE VALUE HALF IS WHAT SAVES THIS ONE. `Other` sits exactly where a
    // generated id sits, so a predicate testing position alone would eat it.
    expect(written('<ul><li>a<h1 class="k" id="Other">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {.k #Other}\n  # H\n',
      semantic: '- a\n  {.k #Other}\n  # H\n',
      roundtrip: '- a\n  {.k #Other}\n  # H\n',
    })
  })

  it('KEEPS an id an author wrote first, even though its value IS the slug', () => {
    // THE POSITION HALF IS WHAT SAVES THIS ONE, and it is the shape that makes
    // this a combination bug rather than a defect in either half: `H` is
    // exactly what `# H` generates, so a predicate testing slug equality alone
    // would eat an id the author demonstrably wrote - this engine would never
    // have emitted it before the `class`.
    expect(written('<ul><li>a<h1 id="H" class="k">H</h1></li></ul>')).toEqual({
      safe: '- a\n  {#H .k}\n  # H\n',
      semantic: '- a\n  {#H .k}\n  # H\n',
      roundtrip: '- a\n  {#H .k}\n  # H\n',
    })
  })

  // `-1` is never written (the first occurrence takes the bare base), a leading
  // zero is not a counter this engine produces, and a tail holding a non-digit
  // is somebody's own suffix. One case per test, because a loop stops at its
  // first failure and leaves the rest of the list unmeasured.
  it.each(['H-1', 'H-02', 'H-x', 'H-', 'H-2x'])('KEEPS %s, a tail that is not a dedup counter', (id) => {
    expect(written(`<ul><li>a<h1 class="k" id="${id}">H</h1></li></ul>`).roundtrip).toBe(
      `- a\n  {.k #${id}}\n  # H\n`,
    )
  })

  it('leaves the section-wrapped placement exactly where it was', () => {
    // A top-level heading's id is on the `<section>`, and that is an unsupported
    // element the importer unwraps in every mode. Nothing here changes it - the
    // carve-out is on the `<h1>` arm, which this shape does not reach with an
    // id at all.
    expect(written('<section id="H"><h1>H</h1></section>')).toEqual({
      safe: '# H\n',
      semantic: '# H\n',
      roundtrip: '# H\n',
    })
  })

  /*
   * THE AMBIGUITY IS IRREDUCIBLE, AND THE RENDER IS WHAT SURVIVES IT.
   *
   * `{.k #H}` and `{.k}` above `# H` render the SAME BYTES, because a generated
   * id goes exactly where that authored one was written. So no importer can
   * tell the two apart, and reading the id as generated cannot change what the
   * document renders - only which of two equivalent spellings is written back.
   * That is the trade carve-rs#1354 ruled on, and it is the reason the carve-out
   * is safe rather than a guess.
   *
   * A review of this change read the same mechanism and called it a loss of
   * authored data. The mechanism is exactly right; the conclusion is what these
   * assertions answer, by showing the HTML is a fixed point in every one of the
   * three spellings - including an authored `{.k #H}`.
   */
  it.each([
    ['a generated id', '- a\n\n  {.k}\n  # H\n'],
    ['an authored id written last whose value IS the slug', '- a\n\n  {.k #H}\n  # H\n'],
    ['an authored id written first', '- a\n\n  {#H .k}\n  # H\n'],
    ['a second heading taking the -2 dedup form', '# H\n\n- a\n\n  {.k}\n  # H\n'],
  ])('re-renders %s to the same HTML it came from', (_label, source) => {
    const html = carveToHtml(source)
    const back = htmlToCarve(html, { mode: 'roundtrip' }).value
    expect(carveToHtml(back)).toBe(html)
  })

  it('is byte-identical to what carve-rs writes for the same input', () => {
    // The table markup-carve/carve-js#1459 measured, with carve-rs at
    // `11ab195f`. The two engines now agree in all three modes on both shapes.
    expect(written('<ul><li>a<h1 class="k" id="H">H</h1></li></ul>').roundtrip).toBe('- a\n  {.k}\n  # H\n')
    expect(written('<ul><li>a<h1 class="k" id="H-2">H</h1></li></ul>').roundtrip).toBe('- a\n  {.k}\n  # H\n')
  })
})
