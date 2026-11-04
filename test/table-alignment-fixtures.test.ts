import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'
import { RULED_TABLE_ALIGNMENT_FIXTURES_5091 } from './ruled-ahead-of-pin-5091.js'

interface TableAlignmentFixture {
  name: string
  canonical: string
  aligned: string
}

const fixtures = JSON.parse(readFileSync(new URL('../spec/resources/spec/table-alignment-fixtures.json', import.meta.url), 'utf8')) as TableAlignmentFixture[]

describe('shared table alignment fixtures', () => {
  for (const pinned of fixtures) {
    const ahead = RULED_TABLE_ALIGNMENT_FIXTURES_5091.get(pinned.name)
    const { name, canonical, aligned } = ahead ? { ...pinned, ...ahead } : pinned
    test(name, () => {
      if (ahead) expect(pinned.canonical, `${name} now matches: delete its ahead-of-pin entry`).not.toBe(ahead.canonical)
      expect(carveToCarve(canonical, { preserveTableSeparators: true })).toBe(canonical)
      expect(carveToCarve(canonical, { alignTables: true, preserveTableSeparators: true })).toBe(aligned)
      expect(carveToCarve(aligned, { alignTables: true, preserveTableSeparators: true })).toBe(aligned)
      expect(carveToCarve(aligned, { preserveTableSeparators: true })).toBe(canonical)
      expect(carveToHtml(aligned)).toBe(carveToHtml(canonical))
    })
  }
})
