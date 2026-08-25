/*
 * A rebuilt figure writes its TARGET's own attribute line, and whatever the
 * merge displaces is declared (ruling markup-carve/carve#1721).
 *
 * THE ID THAT SURVIVED BELONGED TO THE ELEMENT THAT DID NOT. A `<figure id="f">`
 * around a `<table id="g">` was written as `{#f}` over the rows, so the table's
 * own identity was gone from the source, from the re-render and from the report
 * at once - and the only row present described the figure being unspellable,
 * which is a different fact. An id is a link target, so every anchor pointing
 * at that table broke while the document rendered perfectly.
 *
 * BOTH HALVES OR NEITHER. Writing the target's line and forgetting the row
 * would pass an assertion on the emitted Carve alone, so every case below
 * asserts the diagnostics too: the figure's `#f` is displaced by the merge and
 * `attribute-dropped` is what says so. Never resolving a collision by dropping
 * one side in silence is the whole ruling, and a test that watched one side
 * could not see half of it.
 *
 * AND THE RE-RENDER IS THE PROOF THAT IT WORKED. `#g` resolving after a round
 * trip is the property an anchor depends on; a string comparison on the source
 * says only that the bytes moved.
 *
 * THE MERGE IS NOT SYMMETRIC, so the cases separate the three names it treats
 * differently: `id` is a single slot the last line wins, a key-value pair is
 * that slot rule under a name, and `class` is a set the two lines UNION - so a
 * class is never displaced and never owed a row.
 *
 * THE IMAGE ARM IS THE CONTROL. An image writes its attributes inline, after
 * the destination, so the figure's line and the image's braces never meet.
 * Nothing about that arm changes, and the case that says so fails if a later
 * pass makes the collision rule sweep an arm that has no collision.
 */
import { describe, expect, it } from 'vitest'
import type { HtmlImportMode } from '../src/index.js'
import { carveToHtml, htmlToCarve } from '../src/index.js'

const MODES: HtmlImportMode[] = ['safe', 'semantic', 'roundtrip']

const DISPLACED_ID = "info :: attribute-dropped :: Dropped id on <figure>: its target's own attribute line sets id, and the merged pair keeps the target's"
const UNSPELLABLE =
  'warning :: structure-unspellable :: A figure wrapping a table has no Carve spelling; the caption is written on the table, which renders <caption> inside it'

const imported = (html: string, mode: HtmlImportMode) => {
  const { value, report } = htmlToCarve(html, { mode })
  return {
    carve: value,
    rows: report.diagnostics.map((d) => `${d.severity} :: ${d.code} :: ${d.message}`),
  }
}

describe('a figure and its target both carrying attributes', () => {
  /*
   * THE CASE THE RULING IS ABOUT. On the parent commit this emitted
   * `{#f .c}\n| a |\n^ Cap\n` with `structure-unspellable` and nothing else:
   * the authored `id="g"` was gone and no row named it.
   */
  const TABLE = '<figure id="f" class="c"><table id="g" class="d"><tr><td>a</td></tr></table><figcaption>Cap</figcaption></figure>'

  it.each(MODES)('writes the table its own attribute line and declares the displaced id (%s)', (mode) => {
    expect(imported(TABLE, mode)).toEqual({
      carve: '{#f .c}\n{#g .d}\n| a |\n^ Cap\n',
      rows: [UNSPELLABLE, DISPLACED_ID],
    })
  })

  /*
   * THE PROPERTY, NOT THE BYTES. An anchor pointing at `#g` has to resolve
   * after the round trip, and the id the wrapper carried is the one that goes.
   */
  it.each(MODES)('re-renders with the table holding #g, not the figure id (%s)', (mode) => {
    const html = carveToHtml(imported(TABLE, mode).carve)
    expect(html).toContain('id="g"')
    expect(html).not.toContain('id="f"')
    // The classes UNION rather than displacing, so both are still on the table.
    expect(html).toContain('class="c d"')
  })

  /*
   * A QUOTE AND A FENCE STACK TWO BLOCK LINES THE SAME WAY the table does, so
   * the same collision reaches them. Both already wrote the target's line; what
   * they did not do was declare the id the merge displaces.
   */
  it.each(MODES)('declares the displaced id on a quote target (%s)', (mode) => {
    expect(imported('<figure id="f" class="c"><blockquote id="g" class="d"><p>a</p></blockquote><figcaption>Cap</figcaption></figure>', mode)).toEqual({
      carve: '{#f .c}\n{#g .d}\n> a\n^ Cap\n',
      rows: [DISPLACED_ID],
    })
  })

  it.each(MODES)('declares the displaced id on a code-block target (%s)', (mode) => {
    expect(imported('<figure id="f" class="c"><pre id="g" class="d"><code>a</code></pre><figcaption>Cap</figcaption></figure>', mode)).toEqual({
      carve: '{#f .c}\n{#g .d}\n```\na\n```\n^ Cap\n',
      rows: [DISPLACED_ID],
    })
  })

  /*
   * A KEY-VALUE PAIR TAKES THE SLOT RULE UNDER ITS OWN NAME, so a figure and a
   * target setting the same key displaces it and one that sets a different key
   * loses nothing.
   */
  it.each(MODES)('declares a displaced key-value pair by its own name (%s)', (mode) => {
    const { carve, rows } = imported('<figure data-k="1"><blockquote data-k="2"><p>a</p></blockquote><figcaption>Cap</figcaption></figure>', mode)
    expect(carve).toBe('{data-k=1}\n{data-k=2}\n> a\n^ Cap\n')
    expect(rows).toEqual([
      "info :: attribute-dropped :: Dropped data-k on <figure>: its target's own attribute line sets data-k, and the merged pair keeps the target's",
    ])
    expect(carveToHtml(carve)).toContain('data-k="2"')
  })

  it.each(MODES)('owes no row for a key the target does not set (%s)', (mode) => {
    expect(imported('<figure data-k="1"><blockquote data-j="2"><p>a</p></blockquote><figcaption>Cap</figcaption></figure>', mode)).toEqual({
      carve: '{data-k=1}\n{data-j=2}\n> a\n^ Cap\n',
      rows: [],
    })
  })

  /*
   * CLASSES UNION, so neither side is displaced and neither is owed a row.
   * Reporting one here would name a class the output still carries.
   */
  it.each(MODES)('owes no row when only the classes meet (%s)', (mode) => {
    expect(imported('<figure class="c"><table class="d"><tr><td>a</td></tr></table><figcaption>Cap</figcaption></figure>', mode)).toEqual({
      carve: '{.c}\n{.d}\n| a |\n^ Cap\n',
      rows: [UNSPELLABLE],
    })
  })

  /*
   * A TARGET WHOSE WRAPPER CARRIES NOTHING is not a collision either, and its
   * attributes were dropped just as silently before the fix.
   */
  it.each(MODES)('keeps the target attributes when the figure carries none (%s)', (mode) => {
    expect(imported('<figure><table id="g" class="d"><tr><td>a</td></tr></table><figcaption>Cap</figcaption></figure>', mode)).toEqual({
      carve: '{#g .d}\n| a |\n^ Cap\n',
      rows: [UNSPELLABLE],
    })
  })

  /*
   * THE CONTROL. An image writes its attributes inline, so the two never meet,
   * both ids survive and no row is owed. This case passed before the change and
   * has to keep passing after it.
   */
  it.each(MODES)('leaves the image arm alone, where the attributes never meet (%s)', (mode) => {
    const { carve, rows } = imported('<figure id="f" class="c"><img id="g" class="d" src="a.png" alt="A"><figcaption>Cap</figcaption></figure>', mode)
    expect(carve).toBe('{#f .c}\n![A](a.png){#g .d}\n^ Cap\n')
    expect(rows).toEqual([])
    const html = carveToHtml(carve)
    expect(html).toContain('id="f"')
    expect(html).toContain('id="g"')
  })
})
