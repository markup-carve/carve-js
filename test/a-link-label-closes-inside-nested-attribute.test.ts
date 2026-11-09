import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it('lets an enclosing link label close inside a nested link attribute value', () => {
  expect(carveToHtml('[t[x](/u){title="]"}y](/z)\n')).toBe(
    '<p>[t<a href="/u">x</a>{title=“]”}y](/z)</p>',
  )
})

it('still accepts a nested link attribute that ends before its enclosing label', () => {
  expect(carveToHtml('[t[x](/u){title="ok"}y](/z)\n')).toBe(
    '<p><a href="/z">txy</a></p>',
  )
})
