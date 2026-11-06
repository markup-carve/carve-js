import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// carve#5324: a `%%%` span or `%%` line between `+` and its block is skipped like a note (PART 9 §17 L3, CARVE-P9-067).
it.each([
  ['- +\n%%%\nq\n%%%\n```\n\n```\n', '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>'],
  ['- +\n%% c\n%%%\nq\n%%%\n```\n\n```\n', '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>'],
  ['- +\n{x}\n%%%%\nq\n%%%%\n~~~\na\n\nb\n~~~\n', '<ul>\n  <li>\n    <pre x=""><code>a\n\nb\n</code></pre>\n  </li>\n</ul>'],
  [':: t\n: +\n%%%\nq\n%%%\n:::\na\n\nb\n:::\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <div>\n      <p>a</p>\n      <p>b</p>\n    </div>\n  </dd>\n</dl>'],
  ['- +\n%%%\nq\n%%%\n| a |\ntail\n', '<ul>\n  <li>\n    <table>\n      <tbody>\n        <tr><td>a</td></tr>\n      </tbody>\n    </table>\n  </li>\n</ul>\n<p>tail</p>'],
])('attaches the block after a kept comment: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

it('attaches the block after a comment span in the body of a `+` note', () => {
  expect(html('[^m]: +\n  %%%\n  q\n  %%%\n```\n\n```\n\nx[^m]\n')).toContain('<li id="fn1">\n      <pre><code>\n</code></pre>')
})
