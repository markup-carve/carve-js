import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import cases from './fixtures/djot-attribute-wire.json'

describe('Djot attribute values', () => {
  for (const row of cases) {
    it(row.name, () => {
      expect(carveToHtml(djotToCarve(row.source)).trim()).toBe(row.html)
    })
  }
})
