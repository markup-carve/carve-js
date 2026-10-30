import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a postblank block at the enclosing item content column', () => {
  expect(carveToHtml('- - +\nx\n\n  more\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>+\nx</li>\n    </ul>\n    <p>more</p>\n  </li>\n</ul>',
  )
})

it('attaches a block at the marker column and keeps a later block outside', () => {
  expect(carveToHtml('- - +\n  x\n\n  more\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n    <p>more</p>\n  </li>\n</ul>',
  )
})

it('leaves a following sibling outside the continued item', () => {
  expect(carveToHtml('- - +\nx\n\n  more\n- sibling\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>+\nx</li>\n    </ul>\n    <p>more</p>\n  </li>\n  <li><p>sibling</p></li>\n</ul>',
  )
})

it('keeps a refused follower with the innermost plus before a later blank', () => {
  expect(carveToHtml('- - - +\n  x\n\n  more\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li>+\nx</li>\n        </ul>\n      </li>\n    </ul>\n    <p>more</p>\n  </li>\n</ul>',
  )
})
