import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

interface TableAlignmentFixture {
  name: string
  canonical: string
  aligned: string
}

const fixtures = JSON.parse(readFileSync(new URL('../spec/resources/spec/table-alignment-fixtures.json', import.meta.url), 'utf8')) as TableAlignmentFixture[]

describe('shared table alignment fixtures', () => {
  for (const { name, canonical, aligned } of fixtures) {
    test(name, () => {
      expect(carveToCarve(canonical, { preserveTableSeparators: true })).toBe(canonical)
      expect(carveToCarve(canonical, { alignTables: true, preserveTableSeparators: true })).toBe(aligned)
      expect(carveToCarve(aligned, { alignTables: true, preserveTableSeparators: true })).toBe(aligned)
      expect(carveToCarve(aligned, { preserveTableSeparators: true })).toBe(canonical)
      expect(carveToHtml(aligned)).toBe(carveToHtml(canonical))
    })
  }
})
