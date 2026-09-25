/*
 * Carve has no `+` bullet - `+` is the list-continuation marker (PART 9 §17) -
 * so the Markdown importer respells one as `-`. It did that for the marker that
 * OPENS the line only, and `ListMarkers` recorded a nested `+` as a `-` item all
 * the same, so `- + a` left the model saying "a list holding a list" and the
 * source saying "an item of prose" (markup-carve/carve-js#2061).
 *
 * The expectations are cmark-gfm 0.29.0.gfm.13's reading of each source, taken
 * through `scripts/lib/markdown-oracle.mjs` in the spec repo.
 */
import { describe, expect, it } from 'vitest'
import { markdownToCarve, parse, renderHtml } from '../src/index.js'

const html = (markdown: string) => renderHtml(parse(markdownToCarve(markdown))).replace(/\s+/g, '')

describe('a nested plus bullet imports as a list', () => {
  it.each([
    ['- + a', '<ul><li><ul><li>a</li></ul></li></ul>'],
    ['+ + a', '<ul><li><ul><li>a</li></ul></li></ul>'],
    ['* + a', '<ul><li><ul><li>a</li></ul></li></ul>'],
    ['1. + a', '<ol><li><ul><li>a</li></ul></li></ol>'],
    ['1) + a', '<ol><li><ul><li>a</li></ul></li></ol>'],
    ['> - + a', '<blockquote><ul><li><ul><li>a</li></ul></li></ul></blockquote>'],
    // Two and three markers deep, and behind a marker of the other kind.
    ['- + + a', '<ul><li><ul><li><ul><li>a</li></ul></li></ul></li></ul>'],
    ['- - + a', '<ul><li><ul><li><ul><li>a</li></ul></li></ul></li></ul>'],
    ['1. - + a', '<ol><li><ul><li><ul><li>a</li></ul></li></ul></li></ol>'],
    ['- 1. + a', '<ul><li><ol><li><ul><li>a</li></ul></li></ol></li></ul>'],
    // The padding a marker may carry, and content that is not bare text.
    ['-   + a', '<ul><li><ul><li>a</li></ul></li></ul>'],
    ['- +\ta', '<ul><li><ul><li>a</li></ul></li></ul>'],
    ['- + `a`', '<ul><li><ul><li><code>a</code></li></ul></li></ul>'],
    // The box is the sublist item's own text: a task marker is spelled behind a
    // bullet, and cmark-gfm's tasklist extension reaches one marker on a line.
    ['- + [x] a', '<ul><li><ul><li>[x]a</li></ul></li></ul>'],
  ])('reads %s the way cmark-gfm does', (markdown, expected) => {
    expect(html(markdown)).toBe(expected)
  })

  /*
   * THE LINE'S TWO HALVES AGREED ON NOTHING. The second line was respelled
   * because its marker led it and the first was not, so `a` stayed prose in the
   * outer item while `b` opened a sublist. Both markers are the author's `+`, so
   * the second item is a SIBLING of the first - which is why the respell may not
   * change the kind `ListMarkers` records, or the bullet-change rule starts a
   * second list and writes `*`.
   */
  it('keeps two nested items of one list together', () => {
    expect(markdownToCarve('- + a\n  + b')).toBe('- - a\n  - b')
    expect(html('- + a\n  + b')).toBe('<ul><li><ul><li>a</li><li>b</li></ul></li></ul>')
  })

  it('keeps a nested ordered list numbering from its own first marker', () => {
    expect(html('- 3. + a\n     + b')).toBe('<ul><li><olstart="3"><li><ul><li>a</li><li>b</li></ul></li></ol></li></ul>')
  })

  /* CONTROLS. The positions the ticket fixes must not drag these with them. */
  it.each([
    // The leading position was already right.
    ['+ a', '<ul><li>a</li></ul>'],
    // A nesting of markers Carve already spells does not move.
    ['- - a', '<ul><li><ul><li>a</li></ul></li></ul>'],
    ['- 1. a', '<ul><li><ol><li>a</li></ol></li></ul>'],
    ['- * a', '<ul><li><ul><li>a</li></ul></li></ul>'],
    // A `+` that opens nothing is text, in an item and in a paragraph. No space
    // after it, an operand around it, or a column past the item's content.
    ['- +a', '<ul><li>+a</li></ul>'],
    ['- a + b', '<ul><li>a+b</li></ul>'],
    ['- 2 + 2', '<ul><li>2+2</li></ul>'],
    ['a + b', '<p>a+b</p>'],
    ['C++ is a language', '<p>C++isalanguage</p>'],
    ['    - + a', '<pre><code>-+a</code></pre>'],
  ])('leaves %s alone', (markdown, expected) => {
    expect(html(markdown)).toBe(expected)
  })

  /*
   * A literal `+` inside a code span or a fence is never a marker, so the
   * respell may not reach it - the source has to come back byte for byte.
   */
  it('does not respell a plus inside verbatim text', () => {
    expect(markdownToCarve('- `- + a`')).toContain('`- + a`')
    expect(markdownToCarve('```\n- + a\n```')).toContain('- + a')
  })
})
