import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

const rows = (JSON.parse(readFileSync(new URL('../../spec/spec/0.2/data/upgrade-map.json', import.meta.url), 'utf8')) as {
  source: { id: string, from: string, to: string }[]
}).source.filter(row => ['U-423', 'U-424', 'U-425'].includes(row.id))

describe('candidate 17 host extension respellings', () => {
  for (const row of rows) {
    it(`${row.id}: rewrites only with the registered old host and verifies HTML`, () => {
      const host = row.id === 'U-425' ? 'samp' : 'wikilinks'
      expect(upgrade(row.from).output).toBe(row.from)
      const result = upgrade(row.from, [host])
      expect(result.output).toBe(row.to)
      expect(result.check).toBe('explained')
      expect(result.records.some(record => record.entry === row.id)).toBe(true)
    })
  }
  it('rewrites several old host forms in one document', () => {
    const result = upgrade('See [[Main Page|home]] and :samp[ls -l].\n', ['wikilinks', 'samp'])
    expect(result.output).toBe('See :wiki[Main Page|home] and [ls -l]{samp}.\n')
    expect(result.check).toBe('explained')
  })
})
