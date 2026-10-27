import { expect, test } from 'vitest'
import { carveToCarve, parse, renderCarve } from '../src/index.js'

test.each([
  '| a\\ | b |\n',
  '| a\\ | b\\ |\n',
  '|= head\\ | data |\n',
  '| a\\|b\\ | c\\|d |\n',
])('keeps terminal cell hard breaks in %s', (source) => {
  expect(carveToCarve(source)).toBe(source)
  expect(renderCarve(parse(source))).toBe(source)
})
