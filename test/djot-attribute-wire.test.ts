import { describe, expect, it } from 'vitest'
import { carveToHtml, djotToCarve } from '../src/index.js'
import cases from './fixtures/djot-attribute-wire.json'

describe('Djot attribute values', () => {
  for (const row of cases) {
    it(row.name, () => {
      let html = carveToHtml(djotToCarve(row.source)).trim()
      if ('cells' in row) {
        expect(html.match(/<th\b/g) ?? []).toHaveLength(row.cells!)
        expect(html).not.toContain('<span title=')
      } else {
        if ('table' in row) html = html.replace(/>\s+</g, '><').replace(/<\/?thead>/g, '').replace(/ scope="col"/g, '')
        expect(html).toBe(row.html)
      }
    })
  }
})
