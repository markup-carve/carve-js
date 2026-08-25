import { describe, expect, it } from 'vitest'
import { carveToHtml, htmlToAst, htmlToCarve } from '../src/index.js'

/**
 * With `sections` on, `renderHtml` writes a heading's id on the WRAPPER and
 * leaves the heading without one. `roundtrip` unwraps that wrapper - which is
 * right, a `<section>` is not a shape Carve cannot express - so the single
 * attribute the wrapper carried was the single thing the import needed, and
 * `{#install .featured}` over `## Setup` came back as `{.featured}`. That
 * re-renders as `<section id="Setup">`: the author's id is gone and a different
 * one has taken its place, so every anchor pointing at `#install` breaks on a
 * round trip through this engine's own output (markup-carve/carve-js#1475).
 *
 * The loss was DECLARED - `element-unwrapped` plus `attribute-dropped` - and
 * `docs/html-import.md` is explicit that a declared loss is a ceiling, not a
 * licence. The id was on the wrapper and nothing about it was unrecoverable.
 *
 * ## Four qualifiers, and each one is load-bearing
 *
 * - **`roundtrip` only.** That mode's input is Carve-produced HTML by
 *   definition, so a `<section id>` there IS the hoist. In arbitrary HTML it is
 *   a landmark's own id, naming the REGION rather than the heading.
 * - **`<section>` only.** `renderHtml` hoists onto that tag alone; the other
 *   six sectioning names that unwrap here never carry a heading's id.
 * - **the id only.** A class or a data attribute on a wrapper is somebody
 *   else's markup, and writing it onto the heading would render an attribute
 *   the input never had on an element that never had it.
 * - **a DERIVED id stays dropped, silently.** The renderer computes the same
 *   slug again from the same heading, so nothing is lost - and this is the half
 *   a wider fix breaks, which is why markup-carve/carve-js#1459 exists.
 *
 * The port of markup-carve/carve-rs#1381, which ruled the same four in
 * markup-carve/carve-rs#1380. carve-php already behaved this way, so all three
 * engines now agree.
 */

const modes = ['safe', 'semantic', 'roundtrip'] as const

const written = (html: string) =>
  Object.fromEntries(modes.map((mode) => [mode, htmlToCarve(html, { mode }).value]))

const codes = (html: string) =>
  htmlToCarve(html, { mode: 'roundtrip' }).report.diagnostics.map((d) => d.code)

describe('roundtrip restores the id the renderer hoisted onto a section', () => {
  it('hands an authored id back to the heading it was hoisted off', () => {
    expect(written('<section id="install"><h2 class="featured">Setup</h2></section>')).toEqual({
      safe: '{.featured}\n## Setup\n',
      semantic: '{.featured}\n## Setup\n',
      roundtrip: '{#install .featured}\n## Setup\n',
    })
  })

  it('hands it back when it is the only thing the wrapper carried', () => {
    expect(written('<section id="install"><h2>Setup</h2></section>')).toEqual({
      safe: '## Setup\n',
      semantic: '## Setup\n',
      roundtrip: '{#install}\n## Setup\n',
    })
  })

  /*
   * WHAT THE BUG ACTUALLY WAS, stated as the render rather than as a string.
   *
   * A changed spelling is not by itself a defect - `{.k #H}` and `{.k}` write
   * different bytes and render the same document, which is exactly the trade
   * markup-carve/carve-js#1459 ruled acceptable. What made this one a bug is
   * that the round trip put a DIFFERENT id in the document: the author wrote
   * `install`, the re-render said `Setup`. So the assertion is on the HTML, and
   * on the id being the author's rather than merely on the source coming back
   * unchanged.
   */
  it.each([
    ['an id beside a class', '{#install .featured}\n## Setup\n'],
    ['an id on its own', '{#install}\n## Setup\n'],
    ['a nested pair of authored ids', '{#outer}\n# A\n\n{#install .featured}\n## Setup\n'],
  ])('re-renders %s to the HTML it came from', (_label, source) => {
    const html = carveToHtml(source)
    const back = htmlToCarve(html, { mode: 'roundtrip' }).value
    expect(carveToHtml(back)).toBe(html)
  })

  it('keeps the anchor an author wrote, rather than replacing it with a slug', () => {
    // The failure this file exists for, spelled as the two ids: before the fix
    // the second render said `Setup`, so a link to `#install` pointed at
    // nothing and a link to `#Setup` pointed somewhere the author never wrote.
    const html = carveToHtml('{#install .featured}\n## Setup\n')
    expect(html).toContain('id="install"')
    const back = htmlToCarve(html, { mode: 'roundtrip' }).value
    expect(carveToHtml(back)).toContain('id="install"')
    expect(carveToHtml(back)).not.toContain('id="Setup"')
  })

  /*
   * THE HALF A CARELESS FIX BREAKS. `{.featured}` over `## Setup` renders
   * `<section id="Setup">` because the RENDERER derived that slug from the
   * heading's own text - so re-emitting it would write an id the source never
   * had, and markup-carve/carve-js#1459 ruled that a different document. The
   * renderer computes the same value again from the same heading, so dropping
   * it loses nothing and is dropped SILENTLY, exactly as `dropDerived`
   * documents for every other derived value.
   *
   * Slug equality is the whole test here. The POSITION half carve-js#1459 reads
   * off a heading element does not exist on a wrapper: a hoisted id is the only
   * attribute `renderHtml` writes there, so there is no slot order to consult.
   */
  it.each([
    ['with a class beside it', '<section id="Setup"><h2 class="featured">Setup</h2></section>', '{.featured}\n## Setup\n'],
    ['on its own', '<section id="Setup"><h2>Setup</h2></section>', '## Setup\n'],
  ])('leaves a DERIVED id dropped %s', (_label, html, expected) => {
    expect(written(html)).toEqual({ safe: expected, semantic: expected, roundtrip: expected })
  })

  /*
   * READ OFF THE AST, BECAUSE THE WRITER HIDES THIS ONE. `renderCarve`
   * suppresses a heading id equal to the slug the heading would generate, so a
   * fix that handed a DERIVED id back would write the SAME `{.featured}` line
   * and every string assertion above would still pass. The tree is where the
   * difference is: `htmlToAst` hands the heading straight to a consumer, and a
   * node carrying `id: "Setup"` is a document the source never wrote.
   *
   * Measured: deleting the `isGeneratedHeadingId` test from
   * `restoreHoistedSectionId` leaves every string assertion in this file green
   * and fails exactly these two, which is the whole reason they are here.
   */
  it.each([
    ['with a class beside it', '<section id="Setup"><h2 class="featured">Setup</h2></section>', { classes: ['featured'] }],
    ['on its own', '<section id="Setup"><h2>Setup</h2></section>', undefined],
  ])('gives the heading NO id for a derived one %s', (_label, html, attrs) => {
    const [heading] = htmlToAst(html, { mode: 'roundtrip' }).value.children
    expect(heading).toEqual({
      type: 'heading',
      level: 2,
      children: [{ type: 'text', value: 'Setup' }],
      ...(attrs ? { attrs } : {}),
    })
  })

  it('gives the heading the AUTHORED id, in the tree as well as the source', () => {
    const [heading] = htmlToAst('<section id="install"><h2 class="featured">Setup</h2></section>', {
      mode: 'roundtrip',
    }).value.children
    expect(heading).toEqual({
      type: 'heading',
      level: 2,
      children: [{ type: 'text', value: 'Setup' }],
      attrs: { classes: ['featured'], id: 'install' },
    })
  })

  it('leaves the -N dedup form dropped too', () => {
    // `Setup-2` is what a second `## Setup` in the same document is given, so it
    // is an id this engine would have produced itself.
    expect(written('<section id="Setup-2"><h2 class="k">Setup</h2></section>').roundtrip).toBe(
      '{.k}\n## Setup\n',
    )
  })

  it.each(['Setup-1', 'Setup-02', 'Setup-x', 'Setup-', 'Setup-2x'])(
    'RESTORES %s, a tail that is not a dedup counter',
    (id) => {
      // One case per test, because a loop stops at its first failure and leaves
      // the rest of the list unmeasured.
      expect(written(`<section id="${id}"><h2 class="k">Setup</h2></section>`).roundtrip).toBe(
        `{#${id} .k}\n## Setup\n`,
      )
    },
  )

  /*
   * THE BOUNDARIES, so a later change cannot widen them in silence.
   */
  it.each(['article', 'aside', 'footer', 'header', 'main', 'nav'])(
    'leaves an id on <%s> dropped and reported',
    (tag) => {
      // `renderHtml` hoists onto `<section>` alone. An id on any other
      // sectioning wrapper is that landmark's own, naming the region rather
      // than the heading, and moving it would invent a fact.
      const html = `<${tag} id="install"><h2 class="featured">Setup</h2></${tag}>`
      expect(written(html).roundtrip).toBe('{.featured}\n## Setup\n')
      expect(codes(html)).toEqual(['element-unwrapped', 'attribute-dropped'])
    },
  )

  it('leaves a section id dropped and reported in the other two modes', () => {
    // Outside `roundtrip` the input is arbitrary HTML, where a `<section id>`
    // is the region's own.
    for (const mode of ['safe', 'semantic'] as const) {
      const report = htmlToCarve('<section id="install"><h2 class="featured">Setup</h2></section>', { mode })
      expect(report.value).toBe('{.featured}\n## Setup\n')
      expect(report.report.diagnostics.map((d) => d.code)).toEqual([
        'element-unwrapped',
        'attribute-dropped',
      ])
    }
  })

  it('takes only the id, and still reports what stays behind', () => {
    // A class and a data pair on the wrapper are somebody else's markup: they
    // keep the row they have always had, and the heading is not given them.
    const html = '<section id="install" class="wrap" data-x="1"><h2>Setup</h2></section>'
    expect(written(html).roundtrip).toBe('{#install}\n## Setup\n')
    expect(codes(html)).toEqual(['element-unwrapped', 'attribute-dropped'])
  })

  it('leaves a wrapper whose first block is not a heading alone', () => {
    // Nothing hoisted that id, so it is the section's own and stays reported.
    const html = '<section id="install"><p>a</p><h2>Setup</h2></section>'
    expect(written(html).roundtrip).toBe('a\n\n## Setup\n')
    expect(codes(html)).toEqual(['element-unwrapped', 'attribute-dropped'])
  })

  it('leaves a heading that already carries an id alone', () => {
    // Two ids in the rendered document are two different facts, and overwriting
    // the heading's own with the wrapper's would lose one of them.
    const html = '<section id="install"><h2 id="own">Setup</h2></section>'
    expect(written(html).roundtrip).toBe('{#own}\n## Setup\n')
    expect(codes(html)).toEqual(['element-unwrapped', 'attribute-dropped'])
  })

  /*
   * THE DIAGNOSTICS FOLLOW THE OUTCOME. Once the id survives, an
   * `attribute-dropped` row naming it is FALSE, so it goes. The
   * `element-unwrapped` row stays true - the `<section>` really did leave the
   * document - and so does every row about an attribute that really was lost.
   */
  it('stops reporting an id the heading now carries', () => {
    expect(codes('<section id="install"><h2 class="featured">Setup</h2></section>')).toEqual([
      'element-unwrapped',
    ])
  })

  it('stops reporting a derived id too, which is dropped silently', () => {
    expect(codes('<section id="Setup"><h2 class="featured">Setup</h2></section>')).toEqual([
      'element-unwrapped',
    ])
  })

  it('keeps the wrapper row in front of the rows about its children', () => {
    // The attribute rows are now built AFTER the body, so this pins that the
    // report order did not move with them: rows sort by the position of the
    // losing element, and a wrapper stands before everything it wraps.
    const report = htmlToCarve(
      '<section id="install" class="wrap"><h2>Setup</h2><section id="inner" class="w2"><h3>B</h3></section></section>',
      { mode: 'roundtrip' },
    )
    expect(report.report.diagnostics.map((d) => `${d.path} ${d.code}`)).toEqual([
      '/section[1] element-unwrapped',
      '/section[1] attribute-dropped',
      '/section[1]/section[2] element-unwrapped',
      '/section[1]/section[2] attribute-dropped',
    ])
  })

  it('is byte-identical to what carve-rs and carve-php write for the same input', () => {
    // Measured against carve-rs `9c02212` and carve-php `7e11c06`, both of which
    // already produced these four lines.
    expect(written('<section id="install"><h2 class="featured">Setup</h2></section>').roundtrip).toBe(
      '{#install .featured}\n## Setup\n',
    )
    expect(written('<section id="install"><h2>Setup</h2></section>').roundtrip).toBe(
      '{#install}\n## Setup\n',
    )
    expect(written('<section id="Setup"><h2>Setup</h2></section>').roundtrip).toBe('## Setup\n')
    expect(written('<section id="Setup"><h2 class="featured">Setup</h2></section>').roundtrip).toBe(
      '{.featured}\n## Setup\n',
    )
  })
})
