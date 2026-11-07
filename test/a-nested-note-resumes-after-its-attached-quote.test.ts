import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['heading', '- a\n  [^1]: +\n  > q\n    # y\n\nsee[^1]\n', '<blockquote><p>q</p></blockquote>\n      <h1 id="y">y</h1>'],
  ['list', '- a\n  [^1]: +\n  > q\n    - y\n\nsee[^1]\n', '<blockquote><p>q</p></blockquote>\n      <ul>\n        <li>y</li>\n      </ul>'],
  ['description', '- a\n  [^1]: +\n  > q\n    :: y\n    : z\n\nsee[^1]\n', '<blockquote><p>q</p></blockquote>\n      <dl>'],
])('reads a %s at the nested note body column after its attached quote', (_name, source, expected) => {
  expect(carveToHtml(source)).toContain(expected)
})
