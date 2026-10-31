import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// The ruling on carve#4412 makes a definition that misses every item column
// a document definition. A line at an item content column remains item text.

const ABBR = '<abbr title="d">A</abbr>'

describe('a bare-dot ordered item measures abbreviation definitions by column', () => {
  it('defines below the item column', () => {
    expect(carveToHtml('. x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li>x</li>\n</ol>\n<p>' + ABBR + ' here</p>',
    )
  })

  it('expands at the later use site', () => {
    expect(carveToHtml('. x\n*[A]: d\n\nA here\n')).toContain(ABBR)
  })

  it('carries the abutting attribute block too', () => {
    // `.{#i} x` is the same marker with an abutting attribute block, and
    // `RE_ITEM_ATTR` already spelled the bare-dot branch. The prepass has to
    // agree with it or the id lands on an item the prepass says is not there.
    expect(carveToHtml('.{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li id="i">x</li>\n</ol>\n<p>' + ABBR + ' here</p>',
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
    // The marker still opens an item; the definition below misses its column.
    expect(carveToHtml('.{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li id="i">x</li>\n</ol>\n<p>' + ABBR + ' here</p>',
    )
    expect(carveToHtml('1.{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li id="i">x</li>\n</ol>\n<p>' + ABBR + ' here</p>',
    )
    expect(carveToHtml('-{#i} x\n*[A]: d\n\nA here\n')).toBe(
      '<ul>\n  <li id="i">x</li>\n</ul>\n<p>' + ABBR + ' here</p>',
    )
  })

  it('is the same inside a nested list', () => {
    expect(carveToHtml('- a\n  . x\n  *[A]: d\n\nA here\n')).toBe(
      '<ul>\n  <li>a\n    <ol>\n      <li>x\n*[A]: d</li>\n    </ol>\n  </li>\n</ul>\n<p>A here</p>',
    )
  })

  it('the numbered marker follows the same missed-column rule', () => {
    expect(carveToHtml('1. x\n*[A]: d\n\nA here\n')).toBe(
      '<ol>\n  <li>x</li>\n</ol>\n<p>' + ABBR + ' here</p>',
    )
  })

  it('the bullet follows the same missed-column rule', () => {
    expect(carveToHtml('- x\n*[A]: d\n\nA here\n')).toBe(
      '<ul>\n  <li>x</li>\n</ul>\n<p>' + ABBR + ' here</p>',
    )
  })

  it('the paren delimiter follows the same missed-column rule', () => {
    expect(carveToHtml('1) x\n*[A]: d\n\nA here\n')).toBe(
      '<ol data-delim=")">\n  <li>x</li>\n</ol>\n<p>' + ABBR + ' here</p>',
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
