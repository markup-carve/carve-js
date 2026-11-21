import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-024 braced boundaries after the comment ruling', () => {
  it('U-401 rewrites an underline whose closer the comment now takes', () => {
    const result = upgrade('{_a %% b_} y\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toEqual(['U-401'])
  })

  it('U-401 keeps the escaped space before a comment it braces', () => {
    const result = upgrade('{=a\\ %% c=} t and b \\ %% d\n')
    expect(result.output).toBe('{=a\\ {% c%}=} t and b \\ %% d\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toEqual(['U-401'])
  })

  for (const source of ['{-{_a-}_} b-}\n', '{-a-}{+{+b~}+}+}\n']) {
    it(`U-374 cites a nested braced difference: ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.check).toBe('mismatch')
      expect(result.records.map((record) => record.entry)).toEqual(['U-374', 'upgrade-mismatch'])
    })
  }
})
