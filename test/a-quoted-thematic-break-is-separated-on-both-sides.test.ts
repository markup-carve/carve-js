import { describe, it, expect } from 'vitest'
import { markdownToCarveWithLosses } from '../src/markdown-migrate.js'
import { carveToCarve, carveToHtml } from '../src/index.js'

const value = (md: string) => markdownToCarveWithLosses(md).value

// A break is a block of its own, so `fmt` sets what follows it apart from it.
// The importer wrote the separator ABOVE a quoted break and not below, so the
// import was not a fixed point of this engine's own formatter and a repo gating
// on `carve fmt --check` failed on its own migration output (carve-js#2633).
//
// Inside a quote the separator is the quote's own MARKERS, never a bare blank:
// a blank ends the quote and splits it in two. Between two depths it carries
// the shallower one, the way the writer's own separator does.
const cases: [what: string, markdown: string, expected: string][] = [
  ['a break inside a quote', '> a\n> ***\n> b\n', '> a\n>\n> ***\n>\n> b\n'],
  ['a break inside a nested quote', '> > a\n> > ***\n> > b\n', '> > a\n> >\n> > ***\n> >\n> > b\n'],
  ['a break that opens the quote', '> ***\n> b\n', '> ---\n>\n> b\n'],
  ['a break that opens a nested quote', '> > ***\n> > b\n', '> > ---\n> >\n> > b\n'],
  ['two breaks in a row', '> a\n> ***\n> ***\n> b\n', '> a\n>\n> ***\n>\n> ***\n>\n> b\n'],
  ['a break above a list in the quote', '> a\n> ***\n> - x\n', '> a\n>\n> ***\n>\n> - x\n'],
  ['a break leaving the quote\'s list', '> - a\n> ***\n> b\n', '> - a\n>\n> ***\n>\n> b\n'],
  // The separator sits at the SHALLOWER depth: markers the deeper quote does
  // not hold would reopen it.
  ['a break above a deeper quote', '> ***\n> > b\n', '> ---\n>\n> > b\n'],
  ['a break inside a deeper quote above a shallower line', '> > ***\n> b\n', '> > ---\n>\n> b\n'],

  // CONTROLS. These must NOT change, and an unconditional separator would
  // break every one of them.
  //
  // A break the quote's own list item holds is indented past the content
  // column and stays TIGHT - a bare blank there makes the list loose.
  ['a break inside a quoted list item', '> - a\n>   ***\n>   b\n', '> - a\n>   ***\n>   b\n'],
  ['a break inside a list item', '- a\n- ***\n- b\n', '- a\n- ---\n- b\n'],
  // At the document level the separator is a blank line, and the importer
  // already wrote it on both sides.
  ['a break at the document level', 'a\n\n***\n\nb\n', 'a\n\n---\n\nb\n'],
  ['a break under a paragraph', 'a\n***\nb\n', 'a\n\n---\n\nb\n'],
  // Nothing follows the break inside the quote, so there is nothing to set
  // apart: the fix cannot work by always pushing a separator.
  ['a break that ends the quote', '> a\n> ***\n', '> a\n>\n> ***\n'],
  ['a break alone in a quote', '> ***\n', '> ---\n'],
  // The line below already leaves the quote, where the separator is the blank
  // the source wrote.
  ['a break above a line outside the quote', '> ***\n\nb\n', '> ---\n\nb\n'],
  // A document that already separates both sides gains nothing, so the
  // separator is never written twice.
  ['a quote that already separates both sides', '> a\n>\n> ***\n>\n> b\n', '> a\n>\n> ---\n>\n> b\n'],
]

describe('a quoted thematic break is separated on both sides (markup-carve/carve-js#2633)', () => {
  it.each(cases)('writes %s the way the writer does', (_what, md, expected) => {
    expect(value(md)).toBe(expected)
  })

  // The assertion that counts is the ROUND TRIP, not the bytes alone: import,
  // then `fmt`, and require no change.
  it.each(cases)('imports %s as a writer fixed point', (_what, md) => {
    const imported = value(md)
    expect(carveToCarve(imported)).toBe(imported)
  })

  // CONTROL on the separator's SHAPE, which is the whole risk of the change: a
  // BARE blank inside a quote ends it, so the quote would come back as two
  // quotes holding a break between them. Asked of the RENDER, where a split is
  // visible and a separator is not.
  it.each([
    ['a break inside a quote', '> a\n> ***\n> b\n'],
    ['a break inside a nested quote', '> > a\n> > ***\n> > b\n'],
    ['a break that opens the quote', '> ***\n> b\n'],
    ['two breaks in a row', '> a\n> ***\n> ***\n> b\n'],
  ])('keeps %s in ONE quote rather than splitting it in two', (_what, md) => {
    const html = carveToHtml(value(md))

    expect(html.match(/<blockquote>/g)!).toHaveLength(md.startsWith('> >') ? 2 : 1)
    expect(html).toContain('<hr>')
  })

})
