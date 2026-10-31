import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

// PART 9 §17 L1a (CARVE-P9-029): a lead that renders no block of its own (an
// attribute block, a reference definition) followed by a blank and a paragraph
// makes the list loose, as a `+` lead already did (carve-js#4086).
describe('a hidden lead, a blank and a paragraph loosen the list', () => {
  it.each([
    [
      'the ticket shape',
      '- \\\n- {x}\n\n  b\n',
      "<ul>\n  <li><p><br>\n</p></li>\n  <li><p x=\"\">b</p></li>\n</ul>",
    ],
    [
      'an attribute lead before a sibling',
      '- {x}\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\">b</p></li>\n  <li><p>a</p></li>\n</ul>",
    ],
    [
      'two attribute lines',
      '- {x}\n  {y}\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\" y=\"\">b</p></li>\n  <li><p>a</p></li>\n</ul>",
    ],
    [
      'a wrapped attribute block',
      '- {x\n  y}\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\" y=\"\">b</p></li>\n  <li><p>a</p></li>\n</ul>",
    ],
    [
      'an attribute lead and a comment line',
      '- {x}\n  %% c\n\n  b\n- a\n',
      "<ul>\n  <li><p x=\"\">b</p></li>\n  <li><p>a</p></li>\n</ul>",
    ],
    [
      'a reference definition lead',
      '- [r]: /u\n\n  b\n- a\n',
      "<ul>\n  <li><p>b</p></li>\n  <li><p>a</p></li>\n</ul>",
    ],
    [
      'a nested list',
      '- a\n  - {x}\n\n    b\n  - c\n',
      "<ul>\n  <li>a\n    <ul>\n      <li><p x=\"\">b</p></li>\n      <li><p>c</p></li>\n    </ul>\n  </li>\n</ul>",
    ],
    [
      'a quoted list',
      '> - {x}\n>\n>   b\n> - a\n',
      "<blockquote>\n  <ul>\n    <li><p x=\"\">b</p></li>\n    <li><p>a</p></li>\n  </ul>\n</blockquote>",
    ],
    [
      'a heading after the attribute lead stays tight',
      '- {x}\n\n  # b\n- a\n',
      "<ul>\n  <li>\n    <h1 x=\"\" id=\"b\">b</h1>\n  </li>\n  <li>a</li>\n</ul>",
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
