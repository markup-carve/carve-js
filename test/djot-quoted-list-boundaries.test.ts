import { djotToCarveWithLosses } from '../src/djot-import.js'
import { expect, test } from 'vitest'
import { djotToCarve, carveToHtml } from '../src/index.js'
import cases from './fixtures/djot-quoted-list-boundaries.json'

test.each(cases)('preserves quote and list ownership: $source', ({ source, carve }) => {
  expect(carveToHtml(djotToCarve(source))).toBe(carveToHtml(carve))
})

test('reports the plain export loss for a multiline code fallback', () => {
  const result = djotToCarveWithLosses('a `b\n> c` d\n')
  expect(result.losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'Multiline inline code uses raw HTML; plain-text export omits it.',
    line: 1,
  })
})

test.each(['> a `b\n> c` d\n', '- > a `b\n  > c` d\n', 'ref[^n]\n\n[^n]: a\n\np `b\nc` d\n', 'ref[^n]\n\n[^n]: a\n> p `b\n> c` d\n'])('keeps container prefixes out of code-loss diagnostics: %s', source => {
  expect(djotToCarveWithLosses(source).losses).toEqual([])
})

test('keeps output growth linear for wide numeric list markers', () => {
  for (const size of [64, 128, 256]) {
    const source = '0'.repeat(size) + '1. > a\n' + ' > b\n'.repeat(size)
    const result = djotToCarve(source)
    expect(result.length).toBeLessThanOrEqual(source.length * 2)
    expect(carveToHtml(result)).toBe(carveToHtml('1. > a\n' + '   > b\n'.repeat(size)))
  }
})

test('reports multiline footnote code loss at its original opener', () => {
  const result = djotToCarveWithLosses('ref[^n]\n\n[^n]: a `b\nc` d\n')
  expect(result.losses).toContainEqual({
    code: 'structure-unspellable',
    message: 'Multiline inline code uses raw HTML; plain-text export omits it.',
    line: 3,
  })
})
