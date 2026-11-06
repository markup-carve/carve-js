import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).trim()

// carve#5288: invisible lines the host keeps between `+` and its block are skipped (PART 9 §17 L3, CARVE-P9-067),
// so the block after a note is the attached one, with its fence's interior blank.
it.each([
  ['- +\n  [^n]: x\n```\n\n```\n', '<ul>\n  <li>\n    <pre><code>\n</code></pre>\n  </li>\n</ul>'],
  ['- +\n  {x}\n  [^n]: x\n```\n\n```\n', '<ul>\n  <li>\n    <pre x=""><code>\n</code></pre>\n  </li>\n</ul>'],
  ['- a\n+\n  [^n]: x\n```\n\n\nz\n', '<ul>\n  <li>a\n    <pre><code></code></pre>\n  </li>\n</ul>\n<p>z</p>'],
  [':: t\n: +\n  [^n]: x\n> q\n\nz\n', '<dl>\n  <dt>t</dt>\n  <dd>\n    <blockquote><p>q</p></blockquote>\n  </dd>\n</dl>\n<p>z</p>'],
])('attaches the block after a kept note: %j', (source, expected) => {
  expect(html(source)).toBe(expected)
})

it('attaches the block after a note in the body of a `+` note', () => {
  expect(html('[^m]: +\n  [^n]: x\n```\n\n```\n\nsee[^m]\n')).toContain('<li id="fn1">\n      <pre><code>\n</code></pre>')
})
