import { describe, it, expect } from 'vitest'
import { carveToHtml, parse, renderCarve } from '../src/index.js'
import cases from './fixtures/braced-span-host-boundaries.json'

describe('braced span host boundaries', () => {
  for (const row of cases) {
    it(row.name, () => {
      expect(carveToHtml(row.source).trim()).toBe(row.html)
      if (row.roundTrip) {
        expect(carveToHtml(renderCarve(parse(row.source))).trim()).toBe(row.html)
      }
    })
  }
})
