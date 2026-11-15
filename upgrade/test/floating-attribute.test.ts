import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-090, C2-B-095, C2-B-101 floating attributes', () => {
  const cases: [string, string][] = [
    ['> {k}\nt\n', '>\nt\n'],
    ['> {x}\nt\n', '>\nt\n'],
    ['> {#x}\na\n', '>\na\n'],
    ['- a\n  {.x}\ntail\n', '- a\n\ntail\n'],
  ]
  for (const [source, output] of cases) {
    it(`U-141 or U-197 keeps the HTML of ${source.trim()}`, () => {
      const result = upgrade(source)
      expect(result.output).toBe(output)
      expect(result.check).toBe('pass')
      expect(result.records.map((record) => record.entry)).toContain(source.startsWith('>') ? 'U-141' : 'U-197')
    })
  }
})
