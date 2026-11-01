import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L1a/L1b and carve#4639 ruling B: a lead that renders no block of
// its own (an attribute block, a reference definition) separates nothing
// visible, so a blank after it keeps the list tight. A `+` lead still loosens.
describe('a hidden lead, a blank and a paragraph loosen the list', () => {
  it.each([
    [
      'the ticket shape',
      '- \\\n- {x}\n\n  b\n',
      "<ul>\n  <li><br>\n</li>\n  <li><p x=\"\">b</p></li>\n</ul>",
    ],
    [
      'an attribute lead before a sibling',
      '- {x}\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\">b</p></li>\n  <li>a</li>\n</ul>",
    ],
    [
      'two attribute lines',
      '- {x}\n  {y}\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\" y=\"\">b</p></li>\n  <li>a</li>\n</ul>",
    ],
    [
      'a wrapped attribute block',
      '- {x\n  y}\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\" y=\"\">b</p></li>\n  <li>a</li>\n</ul>",
    ],
    [
      'an attribute lead and a comment line',
      '- {x}\n  %% c\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\">b</p></li>\n  <li>a</li>\n</ul>",
    ],
    [
      'a reference definition lead',
      '- [r]: /u\n\n  b\n- a\n',
      "<ul>\n  <li>b</li>\n  <li>a</li>\n</ul>",
    ],
    [
      'a nested list',
      '- a\n  - {x}\n\n    b\n  - c\n',
      "<ul>\n  <li>a\n    <ul>\n      <li><p x=\"\">b</p></li>\n      <li>c</li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a quoted list',
      '> - {x}\n>\n>   b\n> - a\n',
      "<blockquote>\n  <ul>\n    <li><p x=\"\">b</p></li>\n    <li>a</li>\n  </ul>\n</blockquote>",
    ],
    [
      'a heading after the attribute lead stays tight',
      '- {x}\n\n  # b\n- a\n',
      "<ul>\n  <li>\n    <h1 x=\"\" id=\"b\">b</h1>\n  </li>\n  <li>a</li>\n</ul>",
    ],
    [
      'a blank inside a note lead stays tight',
      '- [^n]: note\n    ~~~\n    c\n\n    ~~~\n  b\n- a\n\n[^n]\n',
      "<ul>\n  <li>b</li>\n  <li>a</li>\n</ul>\n<p><a id=\"fnref1\" href=\"#fn1\" role=\"doc-noteref\"><sup>1</sup></a></p>\n<section role=\"doc-endnotes\" aria-label=\"Footnotes\">\n  <hr>\n  <ol>\n    <li id=\"fn1\">\n      <p>note</p>\n      <pre><code>c\n\n</code></pre>\n      <p><a href=\"#fnref1\" role=\"doc-backlink\" aria-label=\"Back to reference\">↩</a></p>\n    </li>\n  </ol>\n</section>",
    ],
    [
      'no blank stays tight',
      '- {x}\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\">b</p></li>\n  <li>a</li>\n</ul>",
    ],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
