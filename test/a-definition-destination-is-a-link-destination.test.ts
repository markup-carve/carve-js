import { describe, it, expect } from 'vitest'
import { carveToHtml, carveToCarve } from '../src/index.js'

/*
 * A reference definition's destination is `link_destination`, the same
 * production as the inline tail's: a parenthesis reaches it only through
 * `balanced_parens` or `destination_escape`, and those three escapes resolve.
 * CARVE-P3-005 anchors the line at its newline, so a run that is not a
 * destination leaves content over and the line is an ordinary paragraph.
 *
 * The trailing attribute block is matched by the production's own pattern
 * rather than scanned off the line first. A scan walking from the start of the
 * line cannot tell a brace or a quote in the DESTINATION from one opening the
 * block, so `[a]: /u{x} {.c}` and `[a]: it's {.c}` were prose and `[a]: {x}`
 * was no definition at all (markup-carve/carve-js#1868).
 */
describe("a definition's destination is link_destination", () => {
  const prose: [string, string, string][] = [
    ['an unclosed parenthesis', '[a]: a(b\n\n[x][a]\n', '<p>[a]: a(b</p>\n<p>[x][a]</p>'],
    ['a parenthesis with no opener', '[a]: a)b\n\n[x][a]\n', '<p>[a]: a)b</p>\n<p>[x][a]</p>'],
    // The inner pair balances and the outer opener does not, so a counter that
    // only asks "did every `)` find an opener" reads this as a definition.
    // `(c)` becomes the copyright sign once the line is prose.
    ['an outer opener left unclosed', '[a]: a(b(c)d\n\n[x][a]\n', '<p>[a]: a(b©d</p>\n<p>[x][a]</p>'],
    // The counts match and the order does not.
    ['a closer before its opener', '[a]: )a(\n\n[x][a]\n', '<p>[a]: )a(</p>\n<p>[x][a]</p>'],
    // The title slot opens only after the destination, so a run that is not one
    // is not rescued by what follows it.
    ['an unclosed parenthesis before a title', '[a]: a(b "T"\n\n[x][a]\n', '<p>[a]: a(b “T”</p>\n<p>[x][a]</p>'],
  ]

  for (const [name, source, expected] of prose) {
    // Asserted as the WHOLE rendering: "no link" also describes an engine that
    // dropped the line, and the fallback the anchor asks for is the author's
    // line surviving as text.
    it(`leaves the line as prose: ${name}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  const destinations: [string, string, string][] = [
    ['a balanced pair', '[a]: a(b)c\n\n[x][a]\n', 'a(b)c'],
    ['nested balanced pairs', '[a]: a((b))c\n\n[x][a]\n', 'a((b))c'],
    ['an escaped opener', '[a]: a\\(b\n\n[x][a]\n', 'a(b'],
    ['an escaped closer', '[a]: a\\)b\n\n[x][a]\n', 'a)b'],
    ['an escaped backslash', '[a]: a\\\\b\n\n[x][a]\n', 'a\\b'],
    // A backslash before anything else is an ordinary destination character.
    ['a backslash before an ordinary character', '[a]: a\\b\n\n[x][a]\n', 'a\\b'],
  ]

  for (const [name, source, href] of destinations) {
    it(`carries the resolved destination: ${name}`, () => {
      expect(carveToHtml(source)).toBe(`<p><a href="${href}">x</a></p>`)
    })
  }

  // The inline tail has always read the production, and it is the control: the
  // same run answers the same way on both sides of the language.
  const inlineControls: [string, string][] = [
    ['[t](a(b)', '<p>[t](a(b)</p>'],
    ['[t](a\\(b)', '<p><a href="a(b">t</a></p>'],
    ['[t](a\\)b)', '<p><a href="a)b">t</a></p>'],
  ]

  for (const [source, expected] of inlineControls) {
    it(`the inline tail reads the same run: ${source}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  it('an image reference takes the resolved destination', () => {
    expect(carveToHtml('![alt][a]\n\n[a]: /i\\(x.png\n')).toBe('<img src="/i(x.png" alt="alt">')
  })

  /*
   * The writer re-escapes what the reader resolved. Writing the resolved value
   * bare would emit `[a]: a(b`, and one `fmt` pass would lose the definition
   * and every link resolving it.
   */
  const roundTrips: [string, string][] = [
    ['an escaped opener', '[x][a]\n\n[a]: a\\(b\n'],
    ['an escaped closer', '[x][a]\n\n[a]: a\\)b\n'],
    ['a balanced pair is left bare', '[x][a]\n\n[a]: a(b)c\n'],
    ['an escaped opener under a title and a block', '[x][a]\n\n[a]: a\\(b "T" {.c}\n'],
  ]

  for (const [name, source] of roundTrips) {
    it(`the writer re-escapes the destination: ${name}`, () => {
      expect(carveToCarve(source)).toBe(source)
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })
  }

  /*
   * A brace or a quote in the destination no longer hides the trailing block.
   */
  const blocks: [string, string, string][] = [
    ['a brace in the destination', '[a]: /u{x} {.c}\n\n[x][a]\n', '<p><a href="/u{x}" class="c">x</a></p>'],
    ['a quote in the destination', "[a]: it's {.c}\n\n[x][a]\n", '<p><a href="it&apos;s" class="c">x</a></p>'],
    // With no space the braces are destination, a different shape from the one
    // above rather than another spelling of it.
    ['no space before the braces', '[a]: /u{.c}\n\n[x][a]\n', '<p><a href="/u{.c}">x</a></p>'],
    ['braces alone', '[a]: {x}\n\n[x][a]\n', '<p><a href="{x}">x</a></p>'],
    // A `}` inside a quoted value does not end the block.
    ['a quoted value carrying a brace', '[a]: /u {k="a} b"}\n\n[x][a]\n', '<p><a href="/u" k="a} b">x</a></p>'],
  ]

  for (const [name, source, expected] of blocks) {
    it(`reads the trailing block: ${name}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }

  const rejectedBlocks: [string, string, string][] = [
    // The slot is exactly one space (carve#912).
    ['two spaces before the block', '[a]: /u  {.c}\n\n[x][a]\n', '<p>[a]: /u  {.c}</p>\n<p>[x][a]</p>'],
    // An invalid block is not `attributes`, so it is leftover content and the
    // anchor disposes of the line (CARVE-P3-006).
    ['an invalid block', '[a]: /u {#}\n\n[x][a]\n', '<p>[a]: /u {#}</p>\n<p>[x][a]</p>'],
  ]

  for (const [name, source, expected] of rejectedBlocks) {
    it(`rejects the line: ${name}`, () => {
      expect(carveToHtml(source)).toBe(expected)
    })
  }
})
