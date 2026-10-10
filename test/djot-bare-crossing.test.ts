import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import fixtures from './fixtures/djot-bare-crossing.json'

describe('Djot bare and forced delimiter crossings', () => {
  for (const row of fixtures) {
    it(row.name, () => {
      const html = carveToHtml(djotToCarve(row.source)).trim()
        .replace(/<\/?tbody>/g, '').replace(/>\s+</g, '><')
      expect(html).toBe(row.html)
    })
  }
})
