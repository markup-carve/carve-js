import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `{%` run in an item closes only at `%}`, so the next block interrupts (carve-js#4843). An unclosed `{%` holds
// no brace line, so that line is the next block's attribute line (carve#5740, option B).
describe('a brace line inside an open item comment run', () => {
  it.each([
    ['quote', '- {% a\n  {lang=de}\n  > q\n  z\n', '<ul>\n  <li>{% a\n    <blockquote lang="de"><p>q\nz</p></blockquote>\n  </li>\n</ul>'],
    ['heading', '- {% a\n  {.x}\n  # h\n  z\n', '<ul>\n  <li>{% a\n    <h1 class="x" id="h">h</h1>\n    z\n  </li>\n</ul>'],
    ['nested list', '- {% a\n  {lang=de}\n  - q\n', '<ul>\n  <li>{% a\n    <ul lang="de">\n      <li>q</li>\n    </ul>\n  </li>\n</ul>'],
    ['ordered item', '1. {% a\n   {lang=de}\n   > q\n', '<ol>\n  <li>{% a\n    <blockquote lang="de"><p>q</p></blockquote>\n  </li>\n</ol>'],
    ['refused run closed by a later line', '- {% a\n  {lang=de}\n  z %} y\n', '<ul>\n  <li>{% a\n{lang=de}\nz %} y</li>\n</ul>'],
  ])('%s', (_name, source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
