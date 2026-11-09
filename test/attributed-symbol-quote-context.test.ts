import { expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

it.each([
  [':a:{.x}"q"', '<p><span class="x">:a:</span>”q”</p>'],
  [':long-name:{#id}"q"', '<p><span id="id">:long-name:</span>”q”</p>'],
  [':a:"q"', '<p>:a:“q”</p>'],
])('reads quote context after %s', (source, expected) => {
  expect(carveToHtml(source).trimEnd()).toBe(expected)
})
