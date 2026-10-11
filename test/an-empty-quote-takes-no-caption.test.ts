import { describe, it, expect } from 'vitest'
import { parse, renderHtml } from '../src/index.js'

/**
 * markup-carve/carve#2892, PART 9 §4d: a structural-only line resets caption
 * scope.
 *
 * A bare `>` is empty once its structural prefix is removed. It is not a blank
 * line, so the one-blank caption allowance never spends it, and the quote it
 * opens holds nothing a caption could be about. Counting it as blank let
 * `| a |` / blank / `>` / blank / `^ cap` render a captioned figure around an
 * empty quote - a host the caption was not written under.
 *
 * All three engines and the oracle agreed on the old reading, so the corpus
 * could not see it; djot.js 0.3.2 drops the `^ ` line entirely there. Keeping
 * the text as a paragraph is the safer half of that disagreement and is what
 * the importers already write.
 */
describe('an empty quote takes no caption', () => {
  const html = (src: string) => renderHtml(parse(src))

  it('does not caption an empty quote between a table and the marker', () => {
    expect(html('| a |\n\n>\n\n^ cap\n')).toBe(
      '<table>\n  <tbody>\n    <tr><td>a</td></tr>\n  </tbody>\n</table>\n<blockquote>\n\n</blockquote>\n<p>^ cap</p>',
    )
  })

  it('does not caption an empty quote adjacent to the marker either', () => {
    expect(html('>\n^ cap\n')).toBe('<blockquote>\n\n</blockquote>\n<p>^ cap</p>')
  })

  it('still captions a quote with content, past a trailing bare marker line', () => {
    expect(html('> q\n>\n\n^ cap\n')).toBe(
      '<figure>\n  <blockquote><p>q</p></blockquote>\n  <figcaption>cap</figcaption>\n</figure>',
    )
  })
})
