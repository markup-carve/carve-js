import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-047 C2-I-048 C2-I-049: combined inline delimiters', () => {
  it('writes the nested spans explicitly', () => {
    const result = upgrade('/***/')
    expect(result.output).toBe('{*{/*/}*}')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-145')
    expect(result.records.map((record) => record.entry)).not.toContain('U-068')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade('/***/\n\n{valigns=top,bottom widths=40}\n| a | b | c |')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('rewrites two combined tokens in one paragraph', () => {
    const result = upgrade('/***/ and /***/')
    expect(result.output).toBe('{*{/*/}*} and {*{/*/}*}')
    expect(result.check).toBe('pass')
  })
})
