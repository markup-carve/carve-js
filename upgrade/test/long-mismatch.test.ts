import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('large upgrade inputs', () => {
  it('keeps an unfixed nested ordered marker as a visible mismatch', () => {
    const input = '- a\n  2. b\n'.repeat(186)
    const result = upgrade(input)
    expect(result.output).toBe(input)
    expect(result.check).toBe('mismatch')
    expect(result.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(true)
  })

  it('keeps a passing document byte identical after a mismatch call', () => {
    upgrade('- a\n  2. b\n')
    const input = 'plain words\n\n'.repeat(157)
    const result = upgrade(input)
    expect(result.output).toBe(input)
    expect(result.check).toBe('pass')
    expect(result.records).toEqual([])
  })
})
