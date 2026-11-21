import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-076 and C2-B-078 description boundary after a blank', () => {
  for (const source of [
    ':: term\n: first\n\n second\n',
    ':: term\n:  first\n\n  second\n',
  ]) {
    it(`U-199 moves the following paragraph out of ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.output).toBe(source.replace(/\n\n +second/, '\n\nsecond'))
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-199')
    })
  }
})
