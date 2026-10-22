import { expect, test } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { djotToCarveWithLosses } from '../src/import/djot/djot-import.js'

test('a trailing ASCII space in a block attribute still applies', () => {
  expect(carveToHtml(djotToCarve('> {#x }\n> a'))).toContain('<p id="x">a</p>')
  expect(djotToCarveWithLosses('> {#x }\n> a').losses).toEqual([])
})

test('empty definition items preserve both the term and description', () => {
  for (const source of [': ', ':']) {
    const result = djotToCarveWithLosses(source)
    expect(result.losses).toEqual([])
    expect(carveToHtml(result.value)).toContain('<dt></dt>')
    expect(carveToHtml(result.value)).toContain('<dd></dd>')
  }
})

test('trailing spaces in an image alternative have an exact loss', () => {
  for (const source of ['![a  \nb](u)', '![a \nb](u)']) expect(djotToCarveWithLosses(source).losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'An image alternative text loses trailing spaces before a line break.',
    line: 1,
  })
})

test('a colon inside a fence is code, not an empty definition term', () => {
  expect(djotToCarveWithLosses('```\n:\n```').losses).toEqual([])
})
