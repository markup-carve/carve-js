import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#5157: a refused `+` leaves no node (CARVE-P11-040), also when a comment line follows it.
it.each([
  ['div', '- ::: d\n+\n%% c\n', '- ::: d\n\n  :::\n  %% c\n'],
  ['raw fence', '- 1. ```=html\n  +\n%% c\n', '- 1. ```=html\n     ```\n\n%% c\n'],
])('writes no + before a comment line below a %s', (_case, source, expected) => {
  const written = carveToCarve(source)
  expect(written).toBe(expected)
  expect(carveToHtml(written)).toBe(carveToHtml(source))
  expect(carveToCarve(written)).toBe(written)
})
