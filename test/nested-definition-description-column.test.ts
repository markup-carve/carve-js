import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ':: a\n: b\n    :: t\n  : zq\n',
  ':: a\n: b\n  \t:: t\n  : zq\n',
  ':: a\n: b\n\t\t:: t\n  : zq\n',
])('attaches a description below a nested list column to its term: %j', source => {
  expect(carveToHtml(source)).toBe('<dl>\n  <dt>a</dt>\n  <dd>\n    <p>b</p>\n    <dl>\n      <dt>t</dt>\n      <dd>zq</dd>\n    </dl>\n  </dd>\n</dl>')
})
