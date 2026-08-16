import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// carve-js#1120.
//
// PART 12 §7 is NORMATIVE and quoted in full, because the whole defect is a
// container test that could not see one container:
//
//   `*[TERM]: expansion` is an `abbreviation_definition` only as a direct child
//   of the document. Written inside a block quote, a list item or a div, the
//   line is not a definition at all: it is ordinary paragraph text, it defines
//   nothing, and it is preserved as the text the author typed.
//
// The definition prepass tracks open list items in `listCols` so it can apply
// that test, and the marker it tracks them with (`RE_PREPASS_MARKER`) enumerated
// every ordered value EXCEPT the Carve-only BARE DOT (`resources/grammar.ebnf`,
// `ordered_marker`, BARE DOT; carve#315). `RE_ORDERED` and `RE_ITEM_ATTR` both
// carry that branch, so the block lexer opened an item the prepass never saw.
//
// The result was the one outcome a definition may never have, in reverse: the
// line was kept as lazy item TEXT and registered as a definition at the same
// time, so the abbreviation expanded inside its own definition and again in
// every later paragraph.
//
// `. ` is a Carve addition with no CommonMark or Djot equivalent, which is why
// it is the ordered marker least likely to have inherited a reference
// implementation's behavior, and why the numbered and bullet controls below
// carry the weight: `. ` and `- ` give the same content column of 2, so the
// column cannot be what separated them.
//
// carve-rs never registered. Every expected string below was measured against
// carve-rs `9b0bc779`, built from a clean checkout.

const ABBR = '<abbr title="d">A</abbr>'

describe('a bare-dot ordered item collects no abbreviation definition', () => {
  it('keeps the line as item text and defines nothing', () => {
    expect(carveToHtml('. x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li>x\n*[A]: d</li>\n</ol>\n<p>A here</p>',
    )
  })

  it('does not expand the abbreviation inside its own definition text', () => {
    // The half of the defect that is visible without reading further: the
    // registered expansion reached back into the line that registered it.
    expect(carveToHtml('. x\n*[A]: d\n\nA here\n')).not.toContain(ABBR)
  })

  it('carries the abutting attribute block too', () => {
    // `.{#i} x` is the same marker with an abutting attribute block, and
    // `RE_ITEM_ATTR` already spelled the bare-dot branch. The prepass has to
    // agree with it or the id lands on an item the prepass says is not there.
    expect(carveToHtml('.{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li id="i">x\n*[A]: d</li>\n</ol>\n<p>A here</p>',
    )
  })

  it('an INVALID abutting brace is no marker at all, under any of the three', () => {
    // Raised in review on the bare-dot row and true of all three markers.
    // `extractItemAttr` is normative for the block lexer: when the payload is
    // not valid attributes, the marker "is not a marker and the line stays
    // ordinary text". The prepass pattern took any brace contents, so `.{#} x`
    // was a paragraph to the lexer and an open item to the prepass, and the
    // column-0 definition under it was read as item content and never
    // registered - rendered as prose AND defining nothing.
    //
    // `1.` and `-` had this already; the bare dot only agreed with carve-rs
    // because the prepass could not see it at all, so adding it to the marker
    // without the validity test would have moved it from an accidental
    // agreement to a consistent divergence. carve-rs registers under all three.
    for (const marker of ['.', '1.', '-']) {
      expect(carveToHtml(marker + '{#} x\n*[A]: d\n\nA here\n')).toBe(
        '<p>' + marker + '{#} x</p>\n<p>' + ABBR + ' here</p>',
      )
    }
  })

  it('CONTROL: a VALID abutting brace still opens the item, under all three', () => {
    // The other side of the same test. Over-rejecting here would put the
    // definition back at document level under a real list item.
    expect(carveToHtml('.{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li id="i">x\n*[A]: d</li>\n</ol>\n<p>A here</p>',
    )
    expect(carveToHtml('1.{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li id="i">x\n*[A]: d</li>\n</ol>\n<p>A here</p>',
    )
    expect(carveToHtml('-{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ul>\n  <li id="i">x\n*[A]: d</li>\n</ul>\n<p>A here</p>',
    )
  })

  it('is the same inside a nested list', () => {
    expect(carveToHtml('- a\n  . x\n  *[A]: d\n\nA here\n')).toBe(
      '<ul>\n  <li>a\n    <ol>\n      <li>x\n*[A]: d</li>\n    </ol>\n  </li>\n</ul>\n<p>A here</p>',
    )
  })

  // The controls. All three were already correct and must stay so: the fix adds
  // one alternative to a marker pattern, and a wrong one would move these.
  it('the numbered marker still defines nothing', () => {
    expect(carveToHtml('1. x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li>x\n*[A]: d</li>\n</ol>\n<p>A here</p>',
    )
  })

  it('the bullet still defines nothing, at the same content column', () => {
    expect(carveToHtml('- x\n*[A]: d\n\nA here\n')).toBe(
      '<ul>\n  <li>x\n*[A]: d</li>\n</ul>\n<p>A here</p>',
    )
  })

  it('the paren delimiter still defines nothing', () => {
    expect(carveToHtml('1) x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li>x\n*[A]: d</li>\n</ol>\n<p>A here</p>',
    )
  })

  it('a blank line first pops the item, and then the definition IS one', () => {
    // The rule is about the CONTAINER, not about the marker: with the item
    // closed the line is a direct child of the document and registers. A fix
    // that suppressed the bare-dot row outright rather than opening the item
    // would break this.
    expect(carveToHtml('. x\n\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li>x</li>\n</ol>\n<p>' + ABBR + ' here</p>',
    )
  })

  it('a link definition under a bare-dot item still resolves, as under a numbered one', () => {
    // §7 governs the abbreviation only. A link definition is collected under
    // both markers, and the fix must not make the bare dot the odd one out in
    // the other direction.
    const bare = carveToHtml('. x\n[r]: /u\n\ny [t][r]\n')
    expect(bare).toContain('href="/u"')
    expect(bare).toBe(carveToHtml('1. x\n[r]: /u\n\ny [t][r]\n'))
  })

  it('reads a quoted fence behind a bare-dot marker, as behind a numbered one', () => {
    // `afterMarker` is the SECOND spelling of the same marker in this pass, and
    // it decides whether the fence a marker line opens is blockquote-stripped.
    expect(carveToHtml('. > ```\n  > *[A]: d\n  > ```\n\nA here\n')).toBe(
      '<ol>\n  <li>\n    <blockquote>\n      <pre><code>*[A]: d\n</code></pre>\n' +
        '    </blockquote>\n  </li>\n</ol>\n<p>A here</p>',
    )
  })
})
