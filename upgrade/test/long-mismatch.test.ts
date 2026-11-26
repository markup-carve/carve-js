import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('large upgrade inputs', () => {
  it('writes U-438 above each nested ordered marker of a large input', () => {
    const input = '- a\n  2. b\n'.repeat(186)
    const result = upgrade(input)
    expect(result.output).toBe('- a\n\n  2. b\n'.repeat(186))
    expect(result.check).toBe('pass')
    expect(result.records.some((record) => record.entry === 'U-438')).toBe(true)
  })

  it('keeps a passing document byte identical after a mismatch call', () => {
    upgrade('- a\n  2. b\n')
    const input = 'plain words\n\n'.repeat(157)
    const result = upgrade(input)
    expect(result.output).toBe(input)
    expect(result.check).toBe('pass')
    expect(result.records).toEqual([])
  })

  it('keeps an unresolved repeated fence source behind the write gate', () => {
    const input = '  x{#i}\n- ````\n  ```\n\n  ^ cap\n- c\n\n'.repeat(64)
    const result = upgrade(input)
    expect(result.check).toBe('mismatch')
    expect(result.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(true)
  })

  it('allows a late footnote definition to resolve the first line', () => {
    const input = 'X[^a].\n\n[^n]: First paragraph of the note.\n\n::: footnotes\nFirst marker.\n:::\n:::\n\n'
      + '::: footnotes\nSecond marker.\n:::\n\n[^a]: note\n'
    expect(upgrade(input).check).toBe('pass')
  })
})
