import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('large upgrade inputs', () => {
  it('closes every open item paragraph before a nested ordered start above one', () => {
    const input = '- a\n  2. b\n'.repeat(186)
    const result = upgrade(input)
    expect(result.output).toBe('- a\n\n  2. b\n'.repeat(186))
    expect(result.check).toBe('pass')
    expect(result.records).toHaveLength(186)
    expect(result.records.every((record) => record.entry === 'U-438')).toBe(true)
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
