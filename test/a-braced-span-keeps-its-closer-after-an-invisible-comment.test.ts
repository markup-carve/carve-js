import { expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

// carve#5209: the comment disappears before a bare closer's flank test.
it.each(['*', '/', '_', '~', '='])('keeps a braced %s span when a comment follows a soft break', (mark) => {
  const source = `{${mark}a\n{% x %}${mark}}\n`
  expect(carveToCarve(source)).toBe(source)
  expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
})

it('keeps the same span when a space precedes the comment', () => {
  const source = '{*a {% x %}*}\n'
  expect(carveToCarve(source)).toBe(source)
  expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
})
