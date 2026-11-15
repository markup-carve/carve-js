import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-069 C2-B-076 C2-B-078 description continuation', () => {
  const cases: [string, string][] = [
    ['real quote body', [':: term', ': +', '> the whole definition is this quote', ''].join('\n')],
    ['list as first definition block', [':: t', ': +', '- a', ''].join('\n')],
    ['heading as first definition block', [':: t', ': +', '# H', ''].join('\n')],
  ]
  for (const [name, source] of cases) {
    it(name, () => {
      const result = upgrade(source)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-123')
    })
  }
})
