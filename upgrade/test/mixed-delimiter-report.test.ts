import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-052 mixed delimiter reports', () => {
  for (const source of ['/*a %% b*/ y\n', '_*`/`/*a*/\n', '*x /*a %% b*/ y*\n']) {
    it(`U-145 explains ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('explained')
      expect(result.records.map((record) => record.entry)).toContain('U-145')
    })
  }
  it('C2-I-047 leaves a separate engine defect visible', () => {
    const result = upgrade('/x /*a %% b*/ y\n')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
