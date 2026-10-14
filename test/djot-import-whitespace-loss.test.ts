import { expect, test } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/djot-import.js'

test('a trailing ASCII space in a block attribute still applies', () => {
  expect(carveToHtml(djotToCarve('> {#x }\n> a'))).toContain('<p id="x">a</p>')
  expect(djotToCarveWithLosses('> {#x }\n> a').losses).toEqual([])
})

test('an empty definition item has an exact loss', () => {
  expect(djotToCarveWithLosses(': ').losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'A definition item with an empty term cannot be spelled in Carve.',
    line: 1,
  })
})

test('trailing spaces in an image alternative have an exact loss', () => {
  expect(djotToCarveWithLosses('![a  \nb](u)').losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'An image alternative text loses trailing spaces before a line break.',
    line: 1,
  })
})
