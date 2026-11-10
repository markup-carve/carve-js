import { expect, it } from 'vitest'
import { carveToHtml, lintCarve } from '../src/index.js'

it('keeps a lazy line in the quote after a sibling ends a hosted comment span', () => {
  expect(carveToHtml('> - a\n>   %%%\n> - b\nx\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>a</li>\n    <li>b\nx</li>\n  </ul>\n</blockquote>',
  )
})

it('opens the nested marker after a refused lazy multiline braced comment', () => {
  const source = '- a\n  - b\n{% c\n  d %}\n    - c\n'
  expect(carveToHtml(source)).toBe(
    '<ul>\n  <li>a\n    <ul>\n      <li>b\n{% c\nd %}\n        <ul>\n          <li>c</li>\n        </ul>\n      </li>\n    </ul>\n  </li>\n</ul>',
  )
  expect(lintCarve(source)).toEqual([])
})
