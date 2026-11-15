import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-108, C2-B-110, C2-B-114 percent fence ownership', () => {
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
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-129')
    })
  }
})
