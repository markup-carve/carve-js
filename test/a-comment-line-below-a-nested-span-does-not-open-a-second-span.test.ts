import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ['- - |\n    %%%\n  %%%%\n  %%%\n  b\nz\n', 'b\nz'],
  ['- - |\n    %%%\n  %%%%\n  %%%\n  b\nq\n', 'b\nq'],
  ['* * |\n    %%%\n  %%%%%\n  %%%\n  b\nz\n', 'b\nz'],
])('keeps the outer item paragraph after a nested comment span', (source, tail) => {
  expect(carveToHtml(source)).toBe(`<ul>\n  <li>\n    <ul>\n      <li>|</li>\n    </ul>\n    ${tail}\n  </li>\n</ul>`)
})
