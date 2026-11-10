import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `{%` run in an item closes only at `%}`, so a brace line inside it is text and the next block interrupts (carve-js#4843).
describe('a brace line inside an open item comment run', () => {
  it.each([
    ['quote', '- {% a\n  {lang=de}\n  > q\n  z\n', '<ul>\n  <li>{% a\n{lang=de}\n    <blockquote><p>q\nz</p></blockquote>\n  </li>\n</ul>'],
    ['heading', '- {% a\n  {.x}\n  # h\n  z\n', '<ul>\n  <li>{% a\n{.x}\n    <h1 id="h">h</h1>\n    z\n  </li>\n</ul>'],
    ['nested list', '- {% a\n  {lang=de}\n  - q\n', '<ul>\n  <li>{% a\n{lang=de}\n    <ul>\n      <li>q</li>\n    </ul>\n  </li>\n</ul>'],
    ['ordered item', '1. {% a\n   {lang=de}\n   > q\n', '<ol>\n  <li>{% a\n{lang=de}\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ol>'],
    ['refused run closed by a later line', '- {% a\n  {lang=de}\n  z %} y\n', '<ul>\n  <li>{% a\n{lang=de}\nz %} y</li>\n</ul>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
