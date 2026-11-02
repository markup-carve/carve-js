import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A colon fence that fails PART 9 §12's opener test is paragraph text and leaves
 * no state (carve#4863, which removed the absorption of CARVE-P9-016). A bare run
 * below it interrupts the item's paragraph and opens a div, so a flush-left line
 * after it ends the item. These shapes used to pin the absorption reading
 * (carve#891); they now pin its removal.
 */
describe('a malformed colon fence leaves no state in an item paragraph', () => {
  const html = (src: string) => carveToHtml(src).trim()

  it('ends the item at the flush-left line, because the bare run opens a div', () => {
    expect(html('- item\n  :::note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\nbody\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('closes the item when the same fence is a VALID opener', () => {
    // The contrast that makes the rule legible: one space between the fence and
    // the type word decides which answer the same five lines get. Here a real
    // admonition opens, its closer completes it, and a closed block leaves no
    // open paragraph - so `tail` ends the item.
    expect(html('- item\n  ::: note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n    <aside class="admonition note" aria-label="Note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('ends the item at a line one column in, below the content column', () => {
    expect(html('- item\n  :::note\n  body\n  :::\n tail\n')).toBe(
      '<ul>\n  <li>item\n:::note\nbody\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('opens the div when the malformed fence is the paragraph’s first line', () => {
    // `- :::note` puts the malformed fence on the marker line, so the item opens
    // with a paragraph that BEGINS with fence-shaped text. The lead line is not
    // fed through the same tracker as the rest, which is exactly where an
    // implementation gets the first case right and this one wrong.
    expect(html('- :::note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>:::note\nbody\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('opens the div inside a block quote, where the prefix matches but the indent does not', () => {
    expect(html('> - item\n>   :::note\n>   body\n>   :::\n> tail\n')).toBe(
      '<blockquote>\n  <ul>\n    <li>item\n:::note\nbody\n      <div>\n\n      </div>\n    </li>\n  </ul>\n  <p>tail</p>\n</blockquote>',
    )
  })

  it('opens the div after a blank line as well', () => {
    expect(html('- item\n  :::note\n\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('opens a div on a WIDER fence too', () => {
    expect(html('- item\n  :::note\n  body\n  ::::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\nbody\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('lets a VALID opener interrupt the paragraph', () => {
    expect(html('- item\n  :::note\n  ::: note\n  body\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\n    <aside class="admonition note" aria-label="Note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('opens the div after a heading or a table as well', () => {
    expect(html('- item\n  :::note\n  # h\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\n    <h1 id="h">h</h1>\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
    expect(html('- item\n  :::note\n  | a |\n  :::\ntail\n')).toBe(
      '<ul>\n  <li>item\n:::note\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n    <div>\n\n    </div>\n  </li>\n</ul>\n<p>tail</p>',
    )
  })

  it('leaves a valid opener inside the item structural after an unrelated paragraph', () => {
    expect(html('- item\n  ::: note\n  body\n  :::\n')).toBe(
      '<ul>\n  <li>item\n    <aside class="admonition note" aria-label="Note">\n      <p>body</p>\n    </aside>\n  </li>\n</ul>',
    )
  })
})
