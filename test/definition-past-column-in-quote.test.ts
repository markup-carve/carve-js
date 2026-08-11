import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * carve-js#648: past a list item's content column a definition is literal text
 * - and this engine declined it outside a block quote while collecting it
 * inside one.
 *
 * Content columns are measured INSIDE the quote (carve#658), so `> - a` puts
 * the column at 2 of the quoted content and a line at 3 is past it exactly as
 * `   ` is past 2 at the top level. The quote must not change the answer.
 *
 * The failure was the quiet kind: a definition that renders nothing and
 * resolves a reference from a line the reader can see as text.
 *
 * Cause: the prepass guard asked `kept === raw`, which really means "does this
 * line carry a marker of its own?" - the exemption that keeps `- [ref]: /url`,
 * where the definition IS the item's content. A quote prefix makes those two
 * differ for the same reason a marker does, so every quoted line skipped the
 * guard entirely.
 */
const resolves = (src: string) => carveToHtml(src).includes('<a href="/u">t</a>')

describe('a definition past the content column is text, quoted or not', () => {
  it('does not collect past the column inside a quote', () => {
    expect(carveToHtml("> - a\n>    [r]: /u\n\nsee [t][r]\n")).toBe(
      '<blockquote>\n  <ul>\n    <li>a\n[r]: /u</li>\n  </ul>\n</blockquote>\n<p>see [t][r]</p>',
    )
  })

  it('answers the same outside a quote', () => {
    expect(resolves('- a\n   [r]: /u\n\nsee [t][r]\n')).toBe(false)
  })
})

describe('the shapes that must keep collecting', () => {
  it('at the column inside a quote (carve#658)', () => {
    expect(resolves("> - a\n\nsee [t][r]\n\n[r]: /u\n")).toBe(true)
  })

  it('at the column outside a quote', () => {
    expect(resolves("- a\n\nsee [t][r]\n\n[r]: /u\n")).toBe(true)
  })

  it('on a quoted marker line, where the definition IS the item', () => {
    // The exemption the guard exists for: `kept` differs from the quote-stripped
    // line because a MARKER was removed, not because a `>` was.
    expect(resolves('> - [r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('on an unquoted marker line', () => {
    expect(resolves('- [r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('quoted at document level', () => {
    expect(resolves('> [r]: /u\n\nsee [t][r]\n')).toBe(true)
  })

  it('at document level', () => {
    expect(resolves('[r]: /u\n\nsee [t][r]\n')).toBe(true)
  })
})
