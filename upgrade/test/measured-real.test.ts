import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'
import fixtures from './measured-real.json' with { type: 'json' }

describe('measured real sources', () => {
  for (const item of fixtures) {
    it(`${item.clause} ${item.cause}: ${item.path}:${item.line}`, () => {
      const result = upgrade(item.input)
      const ids = result.records.map((record) => record.entry)
      expect(result.check).toBe(item.check)
      if (item.check === 'mismatch') expect(ids).toContain('upgrade-mismatch')
      for (const entry of item.entries) expect(ids).toContain(entry)
    })
  }
})
