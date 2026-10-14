import { expect, test } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'

test.each([100, 400, 1600, 6400])('nested literal image labels at depth %i', depth => {
  const input = '!['.repeat(depth) + 'x' + '](u)'.repeat(depth)
  expect(carveToHtml(djotToCarve(input))).toBe('<p><img src="u" alt="x"></p>')
})

test('nested image destinations retain the outer destination', () => {
  expect(carveToHtml(djotToCarve('![![x](inner)](outer)'))).toBe('<p><img src="outer" alt="x"></p>')
  expect(carveToHtml(djotToCarve('![![ä *b*](inner?q=1&n=2)](outer)'))).toBe('<p><img src="outer" alt="ä b"></p>')
})

test.each([
  '`![![x](a)](b)`',
  '```\n![![x](a)](b)\n```',
  '$`![![x](a)](b)`',
])('keeps nested image syntax inside opaque Djot text: %s', source => {
  expect(djotToCarve(source)).toContain('![![x](a)](b)')
})

test('keeps nested image syntax inside an attribute value', () => {
  expect(djotToCarve('{title="![![x](a)](b)"}\na')).toContain('\\!\\[\\!\\[x\\]\\(a\\)\\]\\(b\\)')
})
