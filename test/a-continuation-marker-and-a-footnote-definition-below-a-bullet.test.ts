import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * TWO SPELLINGS OF #2236'S MECHANISM THAT #2306 LEFT: markup-carve/carve-js#2310
 * and markup-carve/carve-js#2311. Both are the definition prepass or the item
 * collector answering for a construct the block parser never builds.
 *
 * A BARE `+` NAMES A BLOCK ONLY INSIDE SOMETHING (#2310). §17 L3 attaches it to
 * the container that holds it, and at document level nothing does: every reader
 * renders a lone `+` as prose there, after a paragraph, after a blank, after a
 * table, a fence, a heading, a break and at the start of the document.
 * `prepassOpensBlock` read it as an opener anyway, so the paragraph read as over,
 * the marker below opened a real item, and that item's definition registered
 * while the page printed the whole run as text.
 *
 * A DEFINITION THAT OPENS A BLOCK KEEPS THE CLAMP (#2311). A below-column line in
 * an item holding a def list is flushed to column 0 so an under-indented
 * `:  def` re-aligns (carve-js#384) and a wrapped term reaches its `dt` without
 * the indent (corpus 156). Neither reason covers a line that opens something at
 * column 0, and the flush handed a definition-shaped one exactly that. #2306
 * covered the link spelling through `declinedLinkDefLines`; a footnote definition
 * returns before the gate that records a decline, so nothing was recorded for it.
 * The column question answers for every definition kind at once.
 *
 * Measured against the oracle (`scripts/spec/layout.mjs` into
 * `scripts/spec/html.mjs` in markup-carve/carve at `b1a59237`, byte-identical at
 * the pinned `e24e38e9`), run rather than read. 187 shapes of a 16320-shape sweep
 * over host by intervening line by marker by definition kind by column move onto
 * it and none moves off.
 */
describe('a bare continuation marker at document level', () => {
  it('leaves the paragraph open, so no definition is harvested below it', () => {
    expect(carveToHtml('[][d]\n+\n- [d]: u\n')).toBe('<p>[][d]\n+\n- [d]: u</p>')
  })

  it('leaves the abbreviation on the folded marker line expandable', () => {
    expect(carveToHtml('x\n+\n- A\n*[A]: b\n')).toBe('<p>x\n+\n- <abbr title="b">A</abbr></p>')
  })

  it('does so after a blank line too, where no paragraph was open at all', () => {
    expect(carveToHtml('x\n\n+\n- [d]: u\n[][d]\n')).toBe(
      '<p>x</p>\n<p>+\n- [d]: u\n[][d]</p>',
    )
  })

  it('does so after a table', () => {
    expect(carveToHtml('| a |\n+\n- [d]: u\n[][d]\n')).toContain('<p>+\n- [d]: u\n[][d]</p>')
  })

  // INSIDE A CONTAINER THE MARKER IS THAT CONTAINER'S ATTACHMENT, so the eager
  // reading stands: the `- A` opens a real item, and PART 12 §7 recognizes an
  // abbreviation definition only at document level.
  it('still attaches inside a quote', () => {
    expect(carveToHtml('> x\n+\n- A\n*[A]: b\n')).toBe(
      '<blockquote>\n  <p>x</p>\n  <ul>\n    <li>A\n*[A]: b</li>\n  </ul>\n</blockquote>',
    )
  })

  it('still attaches inside an item', () => {
    expect(carveToHtml('- x\n+\n- A\n*[A]: b\n')).toBe(
      '<ul>\n  <li>x</li>\n  <li>A\n*[A]: b</li>\n</ul>',
    )
  })

  // A LIST ITEM IS TRANSPARENT ACROSS A BLANK, so the container is still there for
  // the marker to attach to even though the line after a blank pops both column
  // stacks before the verdict is taken. Reading the stacks after those pops made
  // the attached fence read as paragraph continuation, and the definition written
  // inside the code sample went live (raised by codex review).
  it('still attaches to an item across a blank line', () => {
    expect(carveToHtml('[r][]\n\n- a\n\n+\n```\n[r]: /url\n')).not.toContain('href="/url"')
  })

  it('still attaches to an item with no blank before it', () => {
    expect(carveToHtml('[r][]\n\n- a\n+\n```\n[r]: /url\n')).not.toContain('href="/url"')
  })
})

describe('a definition below a bullet whose item holds a def list', () => {
  it('folds a footnote definition into the paragraph the marker line opened', () => {
    expect(carveToHtml('* : |\n [^f]: t\n')).toBe('<ul>\n  <li>: |\n[^f]: t</li>\n</ul>')
  })

  it('folds one under a dash bullet the same way', () => {
    expect(carveToHtml('- : |\n [^f]: t\n')).toBe('<ul>\n  <li>: |\n[^f]: t</li>\n</ul>')
  })

  it('folds one under a description marker with ordinary content', () => {
    expect(carveToHtml('* : x\n [^f]: t\n')).toBe('<ul>\n  <li>: x\n[^f]: t</li>\n</ul>')
  })

  it('folds the link spelling too, which #2306 reached by another route', () => {
    expect(carveToHtml('* : |\n [d]: u\n')).toBe('<ul>\n  <li>: |\n[d]: u</li>\n</ul>')
  })

  // AT the item's content column the definition is real and renders nothing.
  it('still collects a footnote definition at the item content column', () => {
    expect(carveToHtml('* : |\n  [^f]: t\n')).toBe('<ul>\n  <li>: |</li>\n</ul>')
  })

  // The two readings the full flush exists for, and both are unmoved.
  it('still re-aligns an under-indented description marker', () => {
    expect(carveToHtml('- :: t\n : d\n')).toContain('<dd>d</dd>')
  })

  it('still strips a wrapped term continuation to its dt', () => {
    expect(carveToHtml('- one\n\n  :: term\n wrapped\n')).toContain('<dt>term\nwrapped</dt>')
  })
})
