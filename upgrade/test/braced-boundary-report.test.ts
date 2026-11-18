import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-024 braced boundaries after U-201 was withdrawn', () => {
  for (const source of ['{_a %% b_} y\n', '{=a\\ %% c=} t and b \\ %% d\n']) {
    it(`a comment inside a braced form ends before its closer in both versions: ${source.trim()}`, () => {
      const result = upgrade(source)
      expect([result.check, result.records]).toEqual(['pass', []])
    })
  }

  for (const source of ['{-{_a-}_} b-}\n', '{-a-}{+{+b~}+}+}\n']) {
    it(`U-374 cites a nested braced difference: ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('mismatch')
      expect(result.records.map((record) => record.entry)).toEqual(['U-374', 'upgrade-mismatch'])
    })
  }
})
