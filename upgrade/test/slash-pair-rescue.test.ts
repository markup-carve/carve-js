import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-047 C2-I-048: a slash pair across an inner slash', () => {
  it('uses a braced emphasis span to preserve the old pair', () => {
    const result = upgrade('/a /b/\n')
    expect(result.output).toBe('{/a /b/}\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-145')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade('/a /b/\n\n{valigns=top,bottom widths=40}\n| a | b | c |')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
