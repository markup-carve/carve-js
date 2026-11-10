import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

// A `{%` run whose continuation is not indented past its `{` is paragraph text
// (CARVE-P2-035), so it is not a paragraph of only comments (CARVE-P9-042) and a
// `+` reads its gates on it (carve#5195). Each row is the spec model's output.
describe('a refused comment run', () => {
  it.each([
    ['- a\n+\n{% x\n%}\n', '<ul>\n  <li>a\n    {% x\n%}\n  </li>\n</ul>'],
    ['- a\n+\n{% x\n%}\n{y}\n more\n', '<ul>\n  <li>a\n    {% x\n%}\n  </li>\n</ul>\n<p y="">more</p>'],
    ['- +\n{% x\n%}\n# H\n', '<ul>\n  <li>{% x\n%}</li>\n</ul>\n<section id="H">\n  <h1>H</h1>\n</section>'],
    ['- {% c\n  d %}\n\n  Body.\n', '<ul>\n  <li><p>{% c\nd %}</p>\n    <p>Body.</p>\n  </li>\n</ul>'],
    ['- a\n\n{% c\nd %}\n\n- b\n', '<ul>\n  <li>a</li>\n</ul>\n<p>{% c\nd %}</p>\n<ul>\n  <li>b</li>\n</ul>'],
    ['> - a\n> +\n> {% x\n> %}\n', '<blockquote>\n  <ul>\n    <li>a\n      {% x\n%}\n    </li>\n  </ul>\n</blockquote>'],
  ])('renders %j as paragraph text', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })

  it.each([
    ['- a\n+\n{% x\n %}\n# H\n', '<ul>\n  <li>a\n    <h1 id="H">H</h1>\n  </li>\n</ul>'],
    ['- a\n+\n{% x\n %}\n- b\n', '<ul>\n  <li>a</li>\n</ul>\n<p>\n- b</p>'],
  ])('still skips a run continued past its brace: %j', (source, html) => {
    expect(carveToHtml(source)).toBe(html)
  })
})
