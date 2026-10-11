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
    message: 'Multiline inline code containing a quote marker uses raw HTML; plain-text export omits it.',
    line: 2,
  })
})
