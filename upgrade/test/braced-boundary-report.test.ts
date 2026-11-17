import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-060, C2-I-062, C2-I-119 braced boundary reports', () => {
  for (const source of [
    '{_a %% b_} y\n',
    '{-{_a-}_} b-}\n',
    '{-a-}{+{+b~}+}+}\n',
    '{=a\\ %% c=} t and b \\ %% d\n',
    '{-{#x-}\n\n#x-\n',
  ]) {
    it(`U-201 explains ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe(source.startsWith('{-{#') ? 'mismatch' : 'explained')
      expect(result.records.map((record) => record.entry)).toContain('U-201')
      if (source.startsWith('{-{#')) expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
    })
  }

  it('C2-I-119 leaves the failed-opening-brace engine defect visible', () => {
    const result = upgrade('{#foo a\n')
    expect(result.records.map((record) => record.entry)).not.toContain('U-201')
  })
})
