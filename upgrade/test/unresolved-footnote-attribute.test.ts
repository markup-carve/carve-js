import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-043 and C2-I-088 unresolved footnote attributes', () => {
  const cases: [string, string][] = [
    ['Text[^a]{.ref}.\n', 'Text[^a]\\{.ref}.\n'],
    ['x[^n]{#i}\n\n## i\n', 'x[^n]{\\#i}\n\n## i\n'],
  ]
  for (const [source, output] of cases) {
    it(`U-207 preserves literal text in ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.output).toBe(output)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-207')
    })
  }
})
