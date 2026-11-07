import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('ends a quoted description after an erased comment body', () => {
  expect(carveToHtml('> :: t\n> : %% c\npara\n')).toBe('<blockquote>\n  <dl>\n    <dt>t</dt>\n    <dd></dd>\n  </dl>\n</blockquote>\n<p>para</p>')
})
