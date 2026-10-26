import { describe, it, expect } from 'vitest'
import { htmlToCarve, htmlToAst, parse } from '../src/index.js'

/** Under carve#3709, an imported image-only paragraph is a block image. */

const src = (html: string) => htmlToCarve(html)
const rows = (html: string) =>
  src(html).report.diagnostics.filter((d) => d.code === 'structure-unspellable')
const carveOf = (html: string) => src(html).value
const blocks = (doc: { children?: Array<{ type: string }> }) => (doc.children ?? []).map((b) => b.type)

describe("an authored image-only paragraph becomes a block image", () => {
  it('reports the paragraph it cannot spell', () => {
    const result = src('<p><img src="g.jpg" alt="G"></p>')
    expect(result.value).toBe('![G](g.jpg)\n')
    expect(rows('<p><img src="g.jpg" alt="G"></p>')).toEqual([])
  })

  // The row names EXACTLY the structure the two exits differ by, which is what
  // makes it a carve-out rather than an excuse: the tree keeps the paragraph,
  // the re-parsed source has the image as a block, and nothing else moves.
  it('declares the difference the two exits actually have', () => {
    const html = '<p><img src="g.jpg" alt="G"></p>'
    expect(blocks(htmlToAst(html).value)).toEqual(['image'])
    expect(blocks(parse(src(html).value))).toEqual(['image'])
    expect(rows(html)).toHaveLength(0)
  })

  // PART 12 §16's split, and the half that is easy to get wrong: the tree
  // exit loses nothing here, so it must stay silent.
  it('says nothing on the exit that keeps the tree', () => {
    expect(htmlToAst('<p><img src="g.jpg" alt="G"></p>').report.diagnostics).toEqual([])
  })

  it('reports the whitespace-padded spelling of the same paragraph', () => {
    expect(rows('<p>\n  <img src="g.jpg" alt="G">\n</p>')).toHaveLength(0)
  })

  // The paragraph's OWN attributes do not vanish - they land on the image, so
  // `<p class="x">` comes back as `<img class="x">`. That is a different
  // rendering, and the row has to say which one happened.
  it('says where a paragraph attribute went', () => {
    const html = '<p class="x"><img src="g.jpg" alt="G"></p>'
    expect(src(html).value).toBe('![G](g.jpg){.x}\n')
    expect(rows(html)).toEqual([])
  })

  // A MESSAGE THAT OVERCLAIMS LEAVES A LOSS UNDECLARED, which is the same
  // defect one level down. The paragraph's attributes are written as a block
  // ABOVE the image and the image's own `{…}` after it, so a name BOTH set is
  // decided by the image - `{#p}` above `![a](a){#i}` reads back with `id="i"`
  // alone, and `id="p"` is gone. Classes are not in that set: the class slot
  // merges, so `{.p}` and `{.i}` both reach the element.
  it('names an attribute the image overwrites', () => {
    expect(rows('<p id="p"><img id="i" src="a" alt="a"></p>')).toEqual([])
    expect(carveOf('<p id="p"><img id="i" src="a" alt="a"></p>')).toBe('![a](a){#i}\n')
  })

  it('does not name a class, which merges rather than overwriting', () => {
    expect(rows('<p class="p"><img class="i" src="a" alt="a"></p>')).toEqual([])
  })

  it('reports it at every level the tree keeps it', () => {
    expect(rows('<blockquote><p><img src="g.jpg" alt="G"></p></blockquote>')).toHaveLength(0)
    expect(rows('<div><p><img src="g.jpg" alt="G"></p></div>')).toHaveLength(0)
    expect(rows('<ul><li><p><img src="g.jpg" alt="G"></p></li></ul>')).toHaveLength(0)
    expect(rows('<dl><dt>t</dt><dd><p><img src="g.jpg" alt="G"></p></dd></dl>')).toHaveLength(0)
  })

  it('reports each of two such paragraphs once', () => {
    expect(
      rows('<p><img src="g.jpg" alt="G"></p><p><img src="h.jpg" alt="H"></p>'),
    ).toHaveLength(0)
  })
})

/**
 * THE BOUNDS. A row that fires on a shape the writer CAN spell is worse than
 * no row: it declares a loss that did not happen, and the two-exits gate reads
 * `structure-unspellable` as licence to stop comparing. So the composition is
 * checked, not the direction - every shape below keeps its meaning through the
 * writer and must stay silent.
 */
describe('what it does not report', () => {
  // #1411's case. There is no author paragraph to lose - the tree builds the
  // image as a block at every level.
  it('a lone image with no paragraph around it', () => {
    expect(rows('<img src="g.jpg" alt="G">')).toEqual([])
    expect(rows('<div><img src="g.jpg" alt="G"></div>')).toEqual([])
  })

  // A real paragraph on both exits: the image shares its run, so `![G](g) t`
  // re-reads as the paragraph it was.
  it('a paragraph the image shares with anything else', () => {
    expect(rows('<p><img src="g.jpg" alt="G"> text</p>')).toEqual([])
    expect(rows('<p><img src="g.jpg" alt="G"><img src="h.jpg" alt="H"></p>')).toEqual([])
    expect(blocks(parse(src('<p><img src="g.jpg" alt="G"> text</p>').value))).toEqual(['paragraph'])
  })

  // THE OVER-REACH A PREDICATE ON `block()` ALONE MAKES. `captionHost` takes
  // the paragraph back off, so the figure's target is the image on BOTH exits
  // and there is no wrapper left to lose. The candidate is recorded and the
  // node never reaches the tree.
  it('a paragraph a figure already unwrapped', () => {
    const html = '<figure><p><img src="i.png" alt="a"></p><figcaption>cap</figcaption></figure>'
    expect(rows(html)).toEqual([])
    expect(blocks(htmlToAst(html).value)).toEqual(['figure'])
  })

  // NOT A SURVIVOR BOUND, and it does not pretend to be one: a table cell
  // holds INLINES, so no paragraph is ever built for the survivor filter to
  // drop. Disabling the filter leaves this green - the figure case above is
  // what proves the filter. What this pins is the reason it is silent, which
  // is that both exits already agree here.
  it('a paragraph a table cell holds as inlines', () => {
    const html = '<table><tr><td><p><img src="g.jpg" alt="G"></p></td></tr></table>'
    expect(rows(html)).toEqual([])
    expect(JSON.stringify(htmlToAst(html).value)).not.toContain('"paragraph"')
  })

  // THE NEAR MISS. An indented image IS a paragraph holding one image, so a
  // reading that called the shape spellable would point here. It stays a
  // paragraph through `parse`, and the writer still normalizes it to column 0 -
  // which is why the row exists rather than an indented spelling.
  it('the indented source spelling, which the writer cannot reach', () => {
    expect(blocks(parse(' ![G](g.jpg)'))).toEqual(['paragraph'])
    expect(blocks(parse('![G](g.jpg)'))).toEqual(['image'])
  })
})
