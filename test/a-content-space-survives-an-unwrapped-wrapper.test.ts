import { describe, expect, it } from 'vitest'

import { carveToHtml, htmlToCarve } from '../src/index.js'

/**
 * PART 11 §7 DRAWS THE CONTENT LINE AT SPACE AND TAB (markup-carve/carve#1628),
 * and the unwrap path drew it at `String.prototype.trim`
 * (markup-carve/carve-js#1493).
 *
 * `<div>&#160;</div>` wrote nothing. carve-php and carve-rs both write the
 * U+00A0, and `<p>&#160;</p>` keeps it in all three - so this was specific to
 * the path that unwraps a wrapper Carve has no node for, not to non-breaking
 * space handling generally.
 *
 * ONE PREDICATE, NOT ONE CHARACTER. JS trims every Unicode space, so U+202F,
 * U+2002 and U+3000 were dropped by the same line for the same reason; the
 * ticket named the one that was noticed. The fix is the class - Carve's four
 * whitespace characters and nothing wider - so all of them come back at once,
 * and a character nobody has thought of yet is not a fifth ticket.
 *
 * THE ROW FOLLOWS THE CONVERSION. `<progress>&#160;</progress>` used to report
 * `element-dropped`, and that was TRUE about the output it described: nothing
 * came out. Now the character comes out, so the honest row is the unwrap - the
 * one carve-php prints for the same input.
 */
describe('a content space survives an unwrapped wrapper', () => {
  const NBSP = ' '

  const rendered = (html: string) => carveToHtml(htmlToCarve(html).value)

  /*
   * THE TICKET'S TWO INPUTS. The assertion is on the RE-RENDER, because what
   * was lost is a character in the document rather than a spelling.
   */
  const wrappers: Array<[string, string]> = [
    ['a div', `<div>${NBSP}</div>`],
    ['a progress', `<progress value="1">${NBSP}</progress>`],
  ]

  for (const [what, html] of wrappers) {
    it(`keeps a lone non-breaking space inside ${what}`, () => {
      expect(rendered(html)).toMatch(/&nbsp;| /)
    })
  }

  /*
   * THE FAMILY, which is what says the fix is the predicate. Every one of these
   * is content under §7 and every one was dropped by the same line.
   */
  const contentSpaces: Array<[string, string]> = [
    ['NO-BREAK SPACE', ' '],
    ['NARROW NO-BREAK SPACE', ' '],
    ['EN SPACE', ' '],
    ['IDEOGRAPHIC SPACE', '　'],
  ]

  for (const [name, ch] of contentSpaces) {
    it(`keeps a lone ${name}, the way a paragraph already did`, () => {
      // The `<p>` arm reads its content through a trim that knows the
      // difference and always kept these. The two arms now answer alike.
      expect(htmlToCarve(`<div>${ch}</div>`).value).toBe(`${ch}\n`)
      expect(htmlToCarve(`<p>${ch}</p>`).value).toBe(`${ch}\n`)
    })
  }

  /*
   * THE CONTROL, and the risk this shape of fix carries: widening the content
   * side one character too far would turn HTML indentation into text.
   */
  const layout: Array<[string, string]> = [
    ['a space', ' '],
    ['a tab', '\t'],
    ['a newline', '\n'],
    ['a CR', '\r'],
  ]

  for (const [name, ch] of layout) {
    it(`still writes nothing for ${name}`, () => {
      expect(htmlToCarve(`<div>${ch}</div>`).value).toBe('\n')
      expect(rendered(`<div>${ch}</div>`)).toBe('')
    })
  }

  it('still reads pretty-printed indentation as layout', () => {
    // The shape that would break if the predicate went too wide: the text
    // nodes between the two paragraphs are newline plus spaces, and reading
    // them as content would put a paragraph between every indented block.
    const result = htmlToCarve('<div>\n  <p>a</p>\n  <p>b</p>\n</div>')
    expect(result.value).toBe('a\n\nb\n')
  })

  /*
   * THE ROW FOLLOWS. markup-carve/carve#1738 made `element-dropped` truthful
   * about an element that brought nothing; a wrapper holding a content
   * character brings something, so the row it owes is the unwrap.
   */
  it('reports the unwrap rather than a drop when the wrapper held a content space', () => {
    const codes = htmlToCarve(`<progress value="1">${NBSP}</progress>`).report.diagnostics.map((d) => d.code)
    expect(codes).toContain('element-unwrapped')
    expect(codes).not.toContain('element-dropped')
  })

  it('still reports a drop for a wrapper that really brought nothing', () => {
    const codes = htmlToCarve('<progress value="1"> </progress>').report.diagnostics.map((d) => d.code)
    expect(codes).toContain('element-dropped')
    expect(codes).not.toContain('element-unwrapped')
  })
})
