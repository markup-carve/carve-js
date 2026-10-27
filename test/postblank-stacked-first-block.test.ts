import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a postblank block at the enclosing item content column', () => {
  expect(carveToHtml('- - +\nx\n\n  more\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n    <p>more</p>\n  </li>\n</ul>',
  )
})

it('loosens an authored outer paragraph when a later block follows a blank', () => {
  expect(carveToHtml('- - +\n  x\n\n  more\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li></li>\n    </ul>\n    <p>x</p>\n    <p>more</p>\n  </li>\n</ul>',
  )
})

it('leaves a following sibling outside the continued item', () => {
  expect(carveToHtml('- - +\nx\n\n  more\n- sibling\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>x</li>\n    </ul>\n    <p>more</p>\n  </li>\n  <li><p>sibling</p></li>\n</ul>',
  )
})

it('chooses the reached outer owner before reading a later blank', () => {
  expect(carveToHtml('- - - +\n  x\n\n  more\n')).toBe(
    '<ul>\n  <li>\n    <ul>\n      <li>\n        <ul>\n          <li></li>\n        </ul>\n      </li>\n    </ul>\n    <p>x</p>\n    <p>more</p>\n  </li>\n</ul>',
  )
})
