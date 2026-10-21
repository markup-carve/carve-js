import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('opens a second term after the prior description body ends', () => {
  const source = '- 1. ordered\n    :: term\n    :  detail\n      :: term\n      :  detail\n'
  expect(carveToHtml(source)).toBe('<ul>\n  <li>\n    <ol>\n      <li>ordered</li>\n    </ol>\n    <dl>\n      <dt>term</dt>\n      <dd>detail</dd>\n      <dt>term</dt>\n      <dd>detail</dd>\n    </dl>\n  </li>\n</ul>')
})

it('folds a term-shaped line while the first term is still open', () => {
  const source = '- 1. ordered\n    :: term\n      :: next\n'
  expect(carveToHtml(source)).toContain('<dt>term\n  :: next</dt>')
})

it('keeps a term at the description body column inside that description', () => {
  const source = '- 1. ordered\n    :: term\n    :  detail\n       :: next\n'
  expect(carveToHtml(source)).toContain('<dd>\n        <p>detail</p>\n        <dl>\n          <dt>next</dt>\n        </dl>\n      </dd>')
})
