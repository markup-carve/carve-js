import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-089 nested inline footnotes', () => {
  for (const source of [
    'x ^[a ^[b] c]\n',
    'x ^[a ^[b ^[c] d] e]\n',
    '^[x ^[a](u) b]\n',
    '^[x ^[a]{.c} b]\n',
  ]) {
    it(`U-202 escapes inner openers in ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-202')
    })
  }
})
