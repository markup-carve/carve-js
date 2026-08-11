import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * A `>` that does not start the line is a blockquote marker only at an open
 * item's CONTENT COLUMN.
 *
 * Everywhere else the line renders as ordinary text - every engine publishes
 * `> [r]: /u` as prose there - and this engine still collected the definition
 * from it. The reference then resolved through a line the reader sees as text:
 * visible AND active, the mirror of the invisible-and-inactive failures this
 * family produced elsewhere (carve-js#649).
 */
describe('an indented quote-like line', () => {
  for (const indent of [' ', '  ', '   ', '    ']) {
    it(`does not define at indent ${indent.length}`, () => {
      const html = carveToHtml(`[x][r] here.\n\n${indent}> [r]: /u\n`)

      expect(html).toContain('&gt; [r]: /u')
      expect(html).not.toContain('href="/u"')
    })
  }

  it('still defines AT a list item content column', () => {
    // The bound: there the quote is a real container, and all three engines
    // collect from it.
    expect(carveToHtml("- a\n+\n>\n\nsee [t][r]\n\n[r]: /u\n")).toContain('href="/u"')
  })

  it('still defines at column 0', () => {
    expect(carveToHtml(">\n\nsee [t][r]\n\n[r]: /u\n")).toContain('href="/u"')
  })

  it('still defines inside a quoted list item', () => {
    expect(carveToHtml("> - a\n\nsee [t][r]\n\n[r]: /u\n")).toContain('href="/u"')
  })
})
