import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-052 mixed delimiter reports', () => {
  for (const source of ['_*`/`/*a*/\n']) {
    it(`U-145 reports the unverified delimiter change in ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('mismatch')
      expect(result.records.map((record) => record.entry)).toContain('U-145')
      expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
    })
  }
  it.each([
    ['/*a %% b*/ y\n', '*/a{% b%}/* y\n'],
    ['*x /*a %% b*/ y*\n', '*x /\\*a{% b%}*/ y*\n'],
    ['/x /*a %% b*/ y\n', '/x \\/*a{% b%}*/ y\n'],
  ])('U-432 braces the comment 0.1 ended at the closer of %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-432')
  })
})
