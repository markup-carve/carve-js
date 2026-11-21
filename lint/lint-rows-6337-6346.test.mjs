import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const rows = JSON.parse(readFileSync(new URL('../data/conformance/clause-cases.json', import.meta.url), 'utf8')).cases
  .filter((row) => /^CC-155[0-9]$/.test(row.id) || row.id === 'CC-1560')

describe('corrected lint clause rows', () => {
  for (const row of rows) {
    it(row.id, () => {
      const found = lint(row.input, row.options)
      for (const code of row.expected.notReported ?? []) {
        expect(found.filter((item) => item.code === code), `${row.id}: ${code}`).toEqual([])
      }
      for (const expected of row.expected.diagnostics ?? []) {
        const match = found.find((item) => item.code === expected.code)
        expect(match, `${row.id}: ${expected.code}`).toBeDefined()
        expect(match.range.startOffset).toBeGreaterThanOrEqual(0)
      }
    })
  }
})
