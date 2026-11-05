import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

it('folds a column-zero line into the open line block in a nested description', () => {
  const source = '- x\n  :: t\n  : - ::: |\n      # h\nb\n'
  const expected = '<ul>\n  <li>x\n    <dl>\n      <dt>t</dt>\n      <dd>\n        <ul>\n          <li>\n            <div class="line-block">\n              <p># h<br>\nb</p>\n            </div>\n          </li>\n        </ul>\n      </dd>\n    </dl>\n  </li>\n</ul>'
  expect(carveToHtml(source)).toBe(expected)
  const written = carveToCarve(source)
  expect(carveToHtml(written)).toBe(expected)
  expect(carveToCarve(written)).toBe(written)
})

it('formats the continuation with a code span instead of refusing it', () => {
  const source = '- -\n  :: t\n  : - ::: |\n      # h\nb`\n  ```\n'
  expect(() => carveToCarve(source)).not.toThrow()
  expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
})
