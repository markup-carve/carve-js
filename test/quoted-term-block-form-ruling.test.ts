import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('reads a list marker after a quoted item term in the surviving owner', () => {
  expect(carveToHtml('> - :: t\n - x\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>\n<ul>\n  <li>x</li>\n</ul>',
  )
})

it('reads a separator below nested quotes after its term has ended', () => {
  expect(carveToHtml('> > :: t\n : d\n')).toBe(
    '<blockquote>\n  <blockquote>\n    <dl>\n      <dt>t</dt>\n    </dl>\n  </blockquote>\n</blockquote>\n<p>: d</p>',
  )
})

it('removes residual source indent when a separator leaves a quoted term', () => {
  expect(carveToHtml('> :: t\n : d\n')).toBe(
    '<blockquote>\n  <dl>\n    <dt>t</dt>\n  </dl>\n</blockquote>\n<p>: d</p>',
  )
})

it('keeps plain text as a quoted term continuation', () => {
  expect(carveToHtml('> - :: t\n plain\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>\n      <dl>\n        <dt>t\nplain</dt>\n      </dl>\n    </li>\n  </ul>\n</blockquote>',
  )
})
