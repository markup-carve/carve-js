import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, needsAttention, upgrade } from '../src/upgrade.ts'

describe('residual HTML differences name their source', () => {
  it('names a map row and the source range when a rewrite does not preserve HTML', () => {
    const source = '/*a %% `*/` b*/ c\n'
    const result = upgrade(source)
    const mismatch = result.records.find((record) => record.entry === 'upgrade-mismatch')
    expect(result.check).toBe('mismatch')
    expect(mismatch?.message).toContain('U-068')
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

  it('marks a difference with no tool row as a map finding', () => {
    const source = '1.{#k} {#h}\n\n   # h\n'
    const mismatch = upgrade(source).records.find((record) => record.entry === 'upgrade-mismatch')
    expect(mismatch?.message).toContain('no mapped row')
    expect(mismatch?.range).toEqual({ startOffset: 0, endOffset: source.indexOf('\n') })
  })
})
