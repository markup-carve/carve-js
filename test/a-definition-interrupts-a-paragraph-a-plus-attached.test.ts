import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 0 S4: definitions interrupt a paragraph, and a paragraph a first-block
// `+` attached (CARVE-P9-067) continues by the same test (carve-js#4085).
describe('a definition interrupts a paragraph a plus attached', () => {
  it.each([
    [
      'the ticket shape',
      '- +\nn\n  [r]:\n',
      "<ul>\n  <li>n</li>\n</ul>",
    ],
    [
      'a reference definition with a destination',
      '- +\nn\n  [r]: /u\n',
      "<ul>\n  <li>n</li>\n</ul>",
    ],
    [
      'a footnote definition',
      '- +\nn\n  [^f]: x\n',
      "<ul>\n  <li>n</li>\n</ul>",
    ],
    [
      'an auto-numbered item',
      '. +\nn\n   [r]:\n',
      "<ol>\n  <li>n</li>\n</ol>",
    ],
    [
      'an ordered item',
      '1. +\nn\n   [r]: /u\n',
      "<ol>\n  <li>n</li>\n</ol>",
    ],
    [
      'a definition before a later paragraph',
      '- +\nn\n  [r]: /u\n\n  more\n',
      "<ul>\n  <li><p>n</p>\n    <p>more</p>\n  </li>\n</ul>",
    ],
    [
      'a definition the text references',
      'x [r]\n\n- +\nn\n  [r]: /u\n',
      "<p>x [r]</p>\n<ul>\n  <li>n</li>\n</ul>",
    ],
    [
      'a definition below the content column stays text',
      '- +\nn\n [r]: /u\n',
      "<ul>\n  <li>n</li>\n</ul>",
    ],
    [
      // carve#5349 applies the carve#5331 ruling: a block at the content column ends the pulled paragraph.
      'a heading at the content column ends the paragraph',
      '- +\nn\n  # h\n',
      "<ul>\n  <li>n\n    <h1 id=\"h\">h</h1>\n  </li>\n</ul>",
    ],
    [
      'a definition inside a folded fence stays its payload',
      '- +\nn\n  ```\n  [r]: /u\n  ```\n',
      "<ul>\n  <li>n\n    <pre><code>[r]: /u\n</code></pre>\n  </li>\n</ul>",
    ],
    [
      'a shorter closer leaves the next definition in the folded fence',
      '- +\nn\n  ~~~~\n  [r]: /u\n  ~~~\n  [^f]: x\n',
      "<ul>\n  <li>n\n    <pre><code>[r]: /u\n~~~\n[^f]: x\n</code></pre>\n  </li>\n</ul>",
    ],
    [
      'a definition after a colon fence line interrupts',
      '- +\nn\n  ::: note\n  [r]: /u\n  :::\n',
      "<ul>\n  <li>n\n    <aside class=\"admonition note\" aria-label=\"Note\">\n\n    </aside>\n  </li>\n</ul>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
