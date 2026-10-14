import { expect, test } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/djot-import.js'

test('a trailing ASCII space in a block attribute still applies', () => {
  expect(carveToHtml(djotToCarve('> {#x }\n> a'))).toContain('<p id="x">a</p>')
  expect(djotToCarveWithLosses('> {#x }\n> a').losses).toEqual([])
})

test('an empty definition item has an exact loss', () => {
  for (const source of [': ', ':']) expect(djotToCarveWithLosses(source).losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'A definition item with an empty term cannot be spelled in Carve.',
    line: 1,
  })
})

test('trailing spaces in an image alternative have an exact loss', () => {
  for (const source of ['![a  \nb](u)', '![a \nb](u)']) expect(djotToCarveWithLosses(source).losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'An image alternative text loses trailing spaces before a line break.',
    line: 1,
  })
})
