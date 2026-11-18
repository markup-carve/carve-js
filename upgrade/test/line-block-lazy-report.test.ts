import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-123 C2-B-130, U-130: a lazy line in a parsed line block', () => {
  it('cites the line block source range when 0.2 adds a break', () => {
    const source = ':: t\n: > - ::: |\n  >   {#i}\nb\n'
    const result = upgrade(source)
    expect(result.check).toBe('mismatch')
    expect(result.records.find((record) => record.entry === 'U-130')?.range).toEqual({ startOffset: 11, endOffset: 29 })
  })

  it('does not cite the same spelling inside code', () => {
    const source = '```\n:: t\n: > - ::: |\n  >   {#i}\nb\n```\n'
    expect(upgrade(source).records.map((record) => record.entry)).not.toContain('U-130')
  })
})
