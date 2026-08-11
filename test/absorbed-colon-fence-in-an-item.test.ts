import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A colon fence that fails PART 9 §12's opener test opens nothing, so the
 * item's paragraph is still open and PART 1 S4 folds the flush-left line below
 * it into that paragraph.
 *
 * The tracker that decides this used line SHAPE: a bare `:::` set "no open
 * paragraph" whether or not a block had actually been opened. So
 *
 *     - item
 *       :::note
 *       body
 *       :::
 *     tail
 *
 * ended the item and made `tail` a document paragraph - but `:::note` is not an
 * opener (a type word must be separated from the fence by a space), and from
 * there §12 has the paragraph absorb the following fence-shaped line as text
 * too. Nothing ever interrupted the paragraph, so S4 says fold (carve#891, spec
 * corpus `86-list-lazy-continuation-9`).
 *
 * WHAT DECIDES IS WHETHER A BLOCK WAS OPENED, never the shape of the line that
 * tried. That is why the neighbouring shapes below are in the same file rather
 * than in three others: they are consequences of the one reading, and an
 * implementation can get the first one right for the wrong reason.
 */
describe('an absorbed colon fence leaves the item paragraph open', () => {
  const html = (src: string) => carveToHtml(src).trim()

  it('folds the flush-left line, because :::note opened nothing', () => {
    expect(html('- item\n  :::note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\nbody\n:::\ntail</li>\n</ul>',
    )
  })

  it('closes the item when the same fence is a VALID opener', () => {
    // The contrast that makes the rule legible: one space between the fence and
    // the type word decides which answer the same five lines get. Here a real
    // admonition opens, its closer completes it, and a closed block leaves no
    // open paragraph - so `tail` ends the item.
    expect(html("- item\n+\n::: note\nbody\n:::\n\ntail\n")).toBe(
      '<ul>\n  <li>item\n    <aside class="admonition note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('folds a lazy line one column in, which is still below the content column', () => {
    expect(html('- item\n  :::note\n  body\n  :::\n tail\n')).toBe(
      '<ul>\n  <li>item\n:::note\nbody\n:::\ntail</li>\n</ul>',
    )
  })

  it('folds when the malformed fence is the paragraph’s first line', () => {
    // `- :::note` puts the malformed fence on the marker line, so the item opens
    // with a paragraph that BEGINS with fence-shaped text. The lead line is not
    // fed through the same tracker as the rest, which is exactly where an
    // implementation gets the first case right and this one wrong.
    expect(html('- :::note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>:::note\nbody\n:::\ntail</li>\n</ul>',
    )
  })

  it('folds inside a block quote, where the prefix matches but the indent does not', () => {
    expect(html('> - item\n>   :::note\n>   body\n>   :::\n> tail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>item\n:::note\nbody\n:::\ntail</li>\n  </ul>\n</blockquote>',
    )
  })

  it('stops absorbing at a blank line, so the next fence opens again', () => {
    // The boundary. The paragraph that was absorbing ends at the blank, so the
    // `:::` below it IS an opener, the div it opens is closed by nothing before
    // the item ends, and `tail` is a document paragraph again.
    expect(html('- item\n  :::note\n\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\n    <div>\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('absorbs a WIDER fence too, because a malformed opener has no width to match', () => {
    // §12: "the absorption is not width-tagged". After a malformed `:::note` a
    // following `::::` is absorbed as readily as a `:::` - there is no opener
    // length for a width test to compare against.
    expect(html('- item\n  :::note\n  body\n  ::::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\nbody\n::::\ntail</li>\n</ul>',
    )
  })

  it('lets a VALID opener interrupt the absorbing paragraph', () => {
    // Absorption covers a BARE run only. A line that opens something of its own
    // interrupts the absorbing paragraph exactly as it does at the top level,
    // where all three engines render `:::note` over `::: note` as a paragraph
    // plus an admonition. The block it opens is then closed by the `:::` below
    // - that fence is its closer, not more absorbed text - and a closed block
    // leaves no open paragraph, so `tail` ends the item.
    expect(html("- item\n  :::note\n+\n::: note\nbody\n:::\n\ntail\n")).toBe(
      '<ul>\n  <li>item\n:::note\n    <aside class="admonition note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('stops absorbing when a heading or a table ends the paragraph', () => {
    // Absorption belongs to ONE paragraph. A heading between the malformed
    // fence and a later bare `:::` ends it, so that fence opens a real div and
    // `tail` ends the item - which is what the same three lines do at the top
    // level, where `:::note` over `# h` over `:::` is a paragraph, a heading and
    // an empty div in all three engines.
    expect(html("- item\n  :::note\n+\n# h\n+\n:::\n\n:::\n\ntail\n")).toBe(
      '<ul>\n  <li>item\n:::note\n    <h1 id="h">h</h1>\n    <div>\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
    expect(html("- item\n  :::note\n+\n| a |\n+\n:::\n\n:::\n\ntail\n")).toBe(
      '<ul>\n  <li>item\n:::note\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n    <div>\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('leaves a valid opener inside the item structural after an unrelated paragraph', () => {
    // The control for the absorbing flag: a paragraph that never met a
    // malformed fence still gets interrupted by a real opener.
    expect(html("- item\n+\n::: note\nbody\n:::\n")).toBe(
      '<ul>\n  <li>item\n    <aside class="admonition note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>',
    )
  })
})
