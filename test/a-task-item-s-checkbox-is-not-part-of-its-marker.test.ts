import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, htmlToCarve } from '../src/index.js'

/**
 * A TASK ITEM'S `[x] ` IS CONTENT, NOT MARKER.
 *
 * `- [x] a` is the bullet `- `, whose width IS the item's content column, and
 * then `[x] ` which the reader consumes as the item's task state. So the item's
 * content column is 2, exactly as it is for `- a` - the checkbox does not move
 * it, and every block the item holds after its first sits at 2.
 *
 * The writer indented those blocks to the FULL width of what it had written on
 * the marker line - six columns for `- [x] `, ten for `-{#k} [x] ` - which is
 * four past the content column. An ordinary paragraph survives being written
 * there, and that is why this went unseen: a paragraph does not need to be at
 * the content column. A BLOCK OPENER does, and an indented one opens nothing,
 * so a heading, a fence and a quote were each read back as text of the marker
 * line's paragraph (carve-js#1450).
 *
 * The shapes here are stated as `carveToCarve` fixed points with the render
 * held, which is PART 11 §1: a writer that moves the column changes the
 * document, not only its spelling.
 */
describe("a task item's checkbox is not part of its marker", () => {
  const holds = (source: string) => {
    const written = carveToCarve(source)
    expect(written).toBe(source)
    expect(carveToHtml(written)).toBe(carveToHtml(source))
  }

  it('writes a heading after a floating attribute at the content column', () => {
    holds('- [x] {#h}\n  # h\n')
  })

  it('writes a heading after a first paragraph at the content column', () => {
    holds('- [x] a\n  # h\n')
  })

  it('writes a quote after a floating attribute at the content column', () => {
    holds('- [ ] {#h}\n  > q\n')
  })

  it('counts item attributes into the column, and the checkbox out of it', () => {
    // `-{#k} ` is the marker, six wide, so the content column is 6 - not the
    // ten `-{#k} [x] ` occupies.
    holds('-{#k} [x] {#h}\n      # h\n')
  })

  it('leaves a plain item and an ordered item alone', () => {
    holds('- {#h}\n  # h\n')
    holds('1. {#h}\n   # h\n')
  })

  /*
   * THE IMPORT THAT REPORTED IT. carve-js#1416 made the importer keep an
   * authored heading id, which puts it on a floating attribute line - the first
   * shape that ever forced a block opener onto a task item's continuation. The
   * source it wrote did not read back: the visible text moved from `h` to
   * `# h`.
   */
  it('round-trips an imported heading id on a task item', () => {
    const html = '<ul>\n  <li><input type="checkbox" checked disabled> \n    <h1 id="h">h</h1>\n  </li>\n</ul>'
    const written = htmlToCarve(html).value
    expect(written).toBe('- [x] {#h}\n  # h\n')
    expect(carveToHtml(written)).toBe(html)
  })
})
