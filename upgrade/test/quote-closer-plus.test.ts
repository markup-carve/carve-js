import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-059 C2-B-109: a continuation after an empty quote line', () => {
  it('moves the follower into the quote', () => {
    const result = upgrade('>\n+\ne')
    expect(result.output).toBe('>\n> e')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-125')
    expect(result.records.map((record) => record.entry)).not.toContain('U-014')
  })

  it('leaves an unrelated table difference as a mismatch', () => {
    const result = upgrade('{valigns=top,bottom widths=40}\n| a | b | c |\n\n>\n+\ne')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
