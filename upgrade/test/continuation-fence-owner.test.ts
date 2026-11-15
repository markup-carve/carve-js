import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-059 and C2-B-113 continuation fence ownership', () => {
  const cases: [string, string][] = [
    [':: t\n:  d\n+\n```\na\n\nb\n```\n', ':: t\n:  d\n  ```\n  a\n\n  ```\nb\n```\n'],
    ['- x\n+\n```\na\n\nb\n```\n\nz\n', '- x\n  ```\n  a\n\n  ```\nb\n```\n\nz\n'],
  ]
  for (const [source, output] of cases) {
    it(`U-204 closes the fence at the owner boundary of ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.output).toBe(output)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain('U-204')
    })
  }
})
