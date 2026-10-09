import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import { djotEmphasis } from '../src/djot-emphasis.js'
import cases from './fixtures/djot-failed-braced-openers.json'

describe('failed Djot braced openers', () => {
  for (const row of cases) {
    it(row.name, () => {
      expect(carveToHtml(djotToCarve(row.source)).trim()).toBe(row.html)
    })
  }
})

it('keeps long backslash runs intact', () => {
  for (const count of [2000, 8000, 32000]) {
    const source = '\\'.repeat(count) + 'x'
    expect(djotEmphasis(source, plain => plain)).toBe(source)
  }
})
