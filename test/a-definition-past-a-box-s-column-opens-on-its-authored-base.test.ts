import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// CARVE-P0-004, CARVE-P0-011 (carve#3087): in a list item, a link definition or an
// attribute line past a box's content column opens on its authored base, as a
// footnote definition does there.
const cases = [
  {
    name: 'a link definition registers',
    source: '- ::: box\n    [r]: /u\n  :::\n\nsee [x][r]\n',
    html: '<ul>\n  <li>\n    <div class="box">\n\n    </div>\n  </li>\n</ul>\n<p>see <a href="/u">x</a></p>',
  },
  {
    name: 'an attribute line attaches to the next block',
    source: '- ::: box\n    {.k}\n    para\n  :::\n',
    html: '<ul>\n  <li>\n    <div class="box">\n      <p class="k">para</p>\n    </div>\n  </li>\n</ul>',
  },
  {
    name: 'control: outside a list item the line stays text',
    source: '::: box\n  [r]: /u\n:::\n\nsee [x][r]\n',
    html: '<div class="box">\n  <p>[r]: /u</p>\n</div>\n<p>see [x][r]</p>',
  },
]

it.each(cases)('$name', ({ source, html }) => {
  expect(carveToHtml(source).trim()).toBe(html)
})
