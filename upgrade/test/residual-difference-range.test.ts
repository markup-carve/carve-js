import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, needsAttention, upgrade } from '../src/upgrade.ts'

describe('residual HTML differences name their source', () => {
  it('names a map row and the source range when a rewrite does not preserve HTML', () => {
    const source = '_*`/`/*a*/_\n'
    const result = upgrade(source)
    const mismatch = result.records.find((record) => record.entry === 'upgrade-mismatch')
    expect(result.check).toBe('mismatch')
    expect(mismatch?.message).toContain('U-065')
    expect(mismatch?.range).toEqual({ startOffset: 0, endOffset: source.length - 1 })
    expect(needsAttention(result)).toBe(true)
    expect(canWriteUpgrade(result)).toBe(false)
  })

  it('marks a difference with no tool row as a map finding', () => {
    const source = '={_a=b_}\n'
    const mismatch = upgrade(source).records.find((record) => record.entry === 'upgrade-mismatch')
    expect(mismatch?.message).toContain('no mapped row')
    expect(mismatch?.range).toEqual({ startOffset: 0, endOffset: source.length - 1 })
  })
})
