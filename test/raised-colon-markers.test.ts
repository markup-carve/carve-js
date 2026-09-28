import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { carveToCarve, carveToHtml } from '../src/index.js'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/raised-colon-markers.json', import.meta.url), 'utf8')) as { name: string; source: string; html: string }[]

describe('raised colon containers own their paragraph markers (carve#2474)', () => {
  for (const row of fixtures) {
    it(row.name, () => {
      expect(carveToHtml(row.source)).toBe(row.html)
      expect(carveToHtml(carveToCarve(row.source))).toBe(row.html)
    })
  }
  for (const marker of ['- second', '1. second', '- [x] second']) {
    for (const column of [1, 2, 4, 6, 8]) {
      it(`${marker} folds at column ${column}`, () => {
        const source = `- head\n\n      :::\n      a\n${' '.repeat(column)}${marker}\n`
        expect(carveToHtml(source)).toContain(`<p>a\n${marker}</p>`)
      })
    }
  }
})
