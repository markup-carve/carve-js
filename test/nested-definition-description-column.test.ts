import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  ':: a\n: b\n    :: t\n  : zq\n',
  ':: a\n: b\n  \t:: t\n  : zq\n',
  ':: a\n: b\n\t\t:: t\n  : zq\n',
])('keeps a description below a nested list column as text: %j', source => {
  expect(carveToHtml(source)).toBe('<dl>\n  <dt>a</dt>\n  <dd>\n    <p>b</p>\n    <dl>\n      <dt>t</dt>\n    </dl>\n    <p>: zq</p>\n  </dd>\n</dl>')
})
