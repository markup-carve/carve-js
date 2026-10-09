import { describe, it, expect } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'
import cases from './fixtures/quoted-attribute-pair-escapes.json'

describe('quoted attributes inside paired spans', () => {
  for (const row of cases) {
    it(row.name, () => {
      expect(carveToHtml(row.source).trim()).toBe(row.html)
      if (row.roundTrip) {
        expect(carveToHtml(renderCarve(parse(row.source))).trim()).toBe(row.html)
      }
    })
  }
})

it('retains a quoted backtick inside an inline footnote', () => {
  const source = 'a^[x [b]{title="q\\`"} c] d'
  expect(carveToHtml(renderCarve(parse(source)))).toBe(carveToHtml(source))
})
