import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-130 line block report range', () => {
  it('covers the parsed block that owns the differing whitespace', () => {
    const source = '::: |\n😀\tx\n:::\n'
    const result = upgrade(source)
    const report = result.records.find((record) => record.entry === 'U-130')
    const mismatch = result.records.find((record) => record.entry === 'upgrade-mismatch')
    expect(result.check).toBe('mismatch')
    expect(report?.range).toEqual({ startOffset: 0, endOffset: 14 })
    expect(mismatch?.range).toEqual(report?.range)
  })

  it('does not report code block whitespace as a line block difference', () => {
    const result = upgrade('```\n😀\tx\n```\n')
    expect(result.records.map((record) => record.entry)).not.toContain('U-130')
  })
})
