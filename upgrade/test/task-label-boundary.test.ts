import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-H-032 task aria labels at a heading boundary', () => {
  for (const source of [
    '-{#k} [x] bare\n  # inside\n',
    '-{#k} [x] old\n      # outside\n',
    '-{title="😀"} [x] a\n  # h\n',
  ]) {
    it(`U-133 names the changed label in ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('explained')
      expect(result.records.map((record) => record.entry)).toContain('U-133')
    })
  }
})
