import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-044 C2-I-090: tag inside a heading brace', () => {
  it('escapes the brace closer to keep the old tag scan', () => {
    const result = upgrade('# H {#id .cls}\n')
    expect(result.output).toBe('# H {#id .cls\\}\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-256')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade('# H {#id .cls}\n\n|= ^|')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('handles a level-two heading', () => {
    const result = upgrade('## H {#id .cls}\n')
    expect(result.output).toBe('## H {#id .cls\\}\n')
    expect(result.check).toBe('pass')
  })

  it('handles two affected headings together', () => {
    const result = upgrade('# A {#x .y}\n\n# B {#z .q}\n')
    expect(result.output).toBe('# A {#x .y\\}\n\n# B {#z .q\\}\n')
    expect(result.check).toBe('pass')
  })
})
