import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, needsAttention, upgrade } from '../src/upgrade.ts'

describe('residual HTML differences name their source', () => {
  it('names a map row and the source range when a rewrite does not preserve HTML', () => {
    const source = '. q\n1. [1]:\n'
    const result = upgrade(source)
    const mismatch = result.records.find((record) => record.entry === 'upgrade-mismatch')
    expect(result.check).toBe('mismatch')
    expect(mismatch?.message).toContain('U-005')
    expect(mismatch?.range).toEqual({ startOffset: 0, endOffset: source.indexOf('\n') })
    expect(needsAttention(result)).toBe(true)
    expect(canWriteUpgrade(result)).toBe(false)
  })

  it('names U-389 for the braced opener that is now mapped', () => {
    const source = '={_a=b_}\n'
    const result = upgrade(source)
    expect(result.records.find((record) => record.entry === 'U-389')?.range)
      .toEqual({ startOffset: 0, endOffset: source.length - 1 })
    const mismatch = result.records.find((record) => record.entry === 'upgrade-mismatch')
    expect(mismatch?.message).toContain('mapped row U-389')
    expect(mismatch?.range).toEqual({ startOffset: 0, endOffset: source.length - 1 })
  })

  it('no longer leaves a map gap for a consumed marker-line attribute', () => {
    const source = '1.{#k} {#h}\n\n   # h\n'
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-137')
    expect(result.records.some((record) => record.entry === 'upgrade-mismatch')).toBe(false)
  })
})
