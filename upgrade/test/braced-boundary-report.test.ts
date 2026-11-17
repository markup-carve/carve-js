import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-024 braced boundaries after U-201 was withdrawn', () => {
  for (const source of ['{_a %% b_} y\n', '{=a\\ %% c=} t and b \\ %% d\n']) {
    it(`a comment inside a braced form ends before its closer in both versions: ${source.trim()}`, () => {
      const result = upgrade(source)
      expect([result.check, result.records]).toEqual(['pass', []])
    })
  }

  // _SPEC_GAPS.md G-H4: the nested shapes U-201 also covered still differ, and no row of the map names them.
  for (const source of ['{-{_a-}_} b-}\n', '{-a-}{+{+b~}+}+}\n']) {
    it(`a nested braced boundary is an unexplained difference: ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('mismatch')
      expect(result.records.map((record) => record.entry)).toEqual(['upgrade-mismatch'])
    })
  }
})
