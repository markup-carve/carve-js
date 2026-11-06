import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('keeps a quoted description stanza across a marked blank in an open verse span', () => {
  expect(carveToHtml('> :: t\n> : ::: |\n>   x\n>   %%%\n>\nb\n')).toBe(
    '<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd>\n      <div class="line-block">\n        <p>x<br>\nb</p>\n      </div>\n    </dd>\n  </dl>\n</blockquote>',
  )
})

it('leaves the follower outside when no stanza existed before the span', () => {
  expect(carveToHtml('> :: t\n> : ::: |\n>   %%%\n>\nb\n')).toContain('</blockquote>\n<p>b</p>')
})

it('ends the stanza when the blank preceded the span', () => {
  expect(carveToHtml('> :: t\n> : ::: |\n>   x\n>\n>   %%%\n>\nb\n')).toContain('</blockquote>\n<p>b</p>')
})

it('keeps the same stanza in a quoted list item', () => {
  expect(carveToHtml('> - ::: |\n>   x\n>   %%%\n>\nb\n')).toBe(
    '<blockquote>\n  <ul>\n    <li>\n      <div class="line-block">\n        <p>x<br>\nb</p>\n      </div>\n    </li>\n  </ul>\n</blockquote>',
  )
})

it('does not give an unmarked blank outside a list item to its stanza', () => {
  expect(carveToHtml('- ::: |\n  x\n  %%%\n\nb\n')).toContain('</ul>\n<p>b</p>')
})
