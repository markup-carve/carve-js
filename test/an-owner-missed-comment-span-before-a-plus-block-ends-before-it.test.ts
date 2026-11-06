import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// carve-js#4585: an unclosed `%%%` at a `+` item's content column ends at the line that misses its owner
// (PART 0 S1), so that line is no closer and opens the attached block (PART 9 §17 L3).
it.each([
  ['- +\n  %%%\n```\nz\n```\n', '<ul>\n  <li>\n    <pre><code>z\n</code></pre>\n  </li>\n</ul>'],
  ['- +\n  %%%\n  q\n```\nz\n```\n', '<ul>\n  <li>\n    <pre><code>z\n</code></pre>\n  </li>\n</ul>'],
  ['- +\n  %%%\n```\n\n```\n\nx\n', '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>\n<p>x</p>'],
  [':: t\n: +\n  %%%\n> a\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote><p>a</p></blockquote>\n  </dd>\n</dl>'],
])('opens the block at the line the span misses: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})
