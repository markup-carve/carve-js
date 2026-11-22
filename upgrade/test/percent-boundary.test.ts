import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-108, C2-B-110, C2-B-111, C2-B-112 percent fence ownership', () => {
  const cases: [string, string][] = [
    ['- a\n %%% n\n x\n %%%\n tail\n', '- a\n %%% n\n x\n %%%\ntail\n'],
    ['- intro\n%%%\nc\n%%%\n  tail\n', '- intro\n  %%%\n  c\n  %%%\n  tail\n'],
    ['- - a\n %%% c\n x\n %%%\n b\n', '- - a\n %%% c\n x\n %%%\nb\n'],
    [':: t\n:  x\n%%%\ny\n%%%\n   more\n', ':: t\n:  x\n  %%%\n  y\n  %%%\n   more\n'],
    [':: t\n:  x\n %%%\ny\n %%%\nz\n', ':: t\n:  x\n  %%%\n  y\n  %%%\nz\n'],
    [':: t\n:  x\n  %%%\ny\n  %%%\nz\n', ':: t\n:  x\n  %%%\n  y\n  %%%\nz\n'],
    ['- intro\n  %% a\n%%%\nb\n%%%\n  tail\n', '- intro\n  %% a\n  %%%\n  b\n  %%%\n  tail\n'],
  ]
  for (const [source, output] of cases) {
    it(`U-129 keeps the HTML of ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.output).toBe(output)
      expect(result.check).not.toBe('mismatch')
      expect(result.records.map((record) => record.entry)).toContain('U-129')
    })
  }

  it('finds a percent rescue beyond a long unrelated prefix', () => {
    const prefix = 'p\n\n'.repeat(75)
    const result = upgrade(prefix + cases[1]![0])
    expect(result.output).toBe(prefix + cases[1]![1])
    expect(result.check).not.toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('U-129')
  })

  it('keeps the earliest supported opener in the long-source rescue window', () => {
    const prefix = 'p\n\n'.repeat(75)
    const input = `${prefix}- intro\n%%%\n${'c\n'.repeat(10)}%%%\n  tail\n`
    const expected = `${prefix}- intro\n  %%%\n${'  c\n'.repeat(10)}  %%%\n  tail\n`
    const result = upgrade(input)
    expect(result.output).toBe(expected)
    expect(result.check).not.toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('U-129')
  })
})
