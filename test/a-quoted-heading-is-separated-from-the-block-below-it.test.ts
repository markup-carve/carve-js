import { describe, it, expect } from 'vitest'
import { markdownToCarve } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

// A heading is a block of its own, so `carve fmt` sets what follows it apart
// from it. The Markdown importer wrote no separator below a heading inside a
// block quote, so the import was not a fixed point of this engine's own
// formatter and a repo gating on `carve fmt --check` failed on its own
// migration output (carve-js#2642).
//
// Same half-written boundary a thematic break had in carve-js#2633, and the
// same cure: the condition that rule added is widened rather than doubled.
//
// Inside a quote the separator is the quote's own MARKERS, never a bare blank,
// which would end the quote and split it in two.
const cases: [what: string, markdown: string, expected: string][] = [
  ['a heading opening the quote', '> # h\n> b\n', '> # h\n>\n> b\n'],
  ['a deeper heading level', '> ## h\n> b\n', '> ## h\n>\n> b\n'],
  ['a heading in a nested quote', '> > # h\n> > b\n', '> > # h\n> >\n> > b\n'],
  // The telling case: the separator ABOVE was already written, so the boundary
  // was half done.
  ['a heading under a paragraph in the quote', '> a\n> # h\n> b\n', '> a\n>\n> # h\n>\n> b\n'],
  ['a heading above a list in the quote', '> # h\n> - x\n', '> # h\n>\n> - x\n'],
  ['a heading leaving the quote\'s list', '> - a\n> # h\n> b\n', '> - a\n>\n> # h\n>\n> b\n'],
  // A setext underline reaches the separator rule ALREADY written as `# Title`,
  // so it needs no rule of its own. This is why the condition is asked of the
  // EMITTED line rather than the source.
  ['a setext heading in the quote', '> Title\n> =====\n> b\n', '> # Title\n>\n> b\n'],

  // CONTROLS. These must NOT change, and an unconditional separator would
  // break every one of them.
  //
  // A heading the quote's own list item holds is indented past the content
  // column and stays TIGHT - a bare blank there makes the list loose.
  ['a heading inside a quoted list item', '> - a\n>   # h\n>   b\n', '> - a\n>   # h\n>   b\n'],
  ['a heading inside a list item', '- a\n- # h\n- b\n', '- a\n- # h\n- b\n'],
  // At the document level the separator is a blank line, already written.
  ['a heading at the document level', '# h\nb\n', '# h\n\nb\n'],
  // Nothing follows inside the quote, so there is nothing to set apart.
  ['a heading that ends the quote', '> # h\n', '> # h\n'],
  // Already separated, so the separator is never written twice.
  ['a quote that already separates them', '> # h\n>\n> b\n', '> # h\n>\n> b\n'],
  // A deeper quote below was already set apart by another rule.
  ['a heading above a deeper quote', '> # h\n> > b\n', '> # h\n>\n> > b\n'],
]

describe('a quoted heading is separated from the block below it (markup-carve/carve-js#2642)', () => {
  it.each(cases)('writes %s the way the writer does', (_what, md, expected) => {
    expect(markdownToCarve(md)).toBe(expected)
  })

  // The assertion that counts is the ROUND TRIP, not the bytes alone.
  it.each(cases)('imports %s as a writer fixed point', (_what, md) => {
    const imported = markdownToCarve(md)
    expect(carveToCarve(imported)).toBe(imported)
  })

  // CONTROL on the separator's SHAPE, which is the whole risk: a BARE blank
  // inside a quote ends it, so the quote would come back as two quotes. Asked
  // of the RENDER, where a split is visible and a separator is not.
  it.each([
    ['a heading opening the quote', '> # h\n> b\n', 1],
    ['a heading under a paragraph', '> a\n> # h\n> b\n', 1],
    ['a heading in a nested quote', '> > # h\n> > b\n', 2],
    ['a setext heading in the quote', '> Title\n> =====\n> b\n', 1],
  ])('keeps %s in ONE quote rather than splitting it in two', (_what, md, quotes) => {
    const html = carveToHtml(markdownToCarve(md))

    expect(html.match(/<blockquote>/g)!).toHaveLength(quotes as number)
    expect(html).toMatch(/<h[12][ >]/)
  })

  // CONTROL. A heading the list item holds keeps the list TIGHT, which the
  // render states plainly: a loose item wraps its text in a paragraph.
  it('keeps a quoted list item tight around a heading it holds', () => {
    const html = carveToHtml(markdownToCarve('> - a\n>   # h\n>   b\n'))

    expect(html).not.toContain('<li>\n  <p>')
  })
})
