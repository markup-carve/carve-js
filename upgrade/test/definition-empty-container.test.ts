import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-081 C2-B-083: empty definitions inside list items', () => {
  it('replaces a consumed definition with an empty item', () => {
    const result = upgrade('* [d]:\n')
    expect(result.output).toBe('* {% %}\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-131')
  })

  it('keeps an unrelated table difference as a mismatch', () => {
    const result = upgrade('|= ^|\n\n* [d]:\n')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('keeps a nested item empty and releases a following colon line', () => {
    const result = upgrade('* * [d]: u\n :\n')
    expect(result.output).toBe('* * {% %}\n\n:\n')
    expect(result.check).toBe('pass')
  })

  it('does not hide an unrelated table difference beside the nested item', () => {
    const result = upgrade('* * [d]: u\n :\n\n|= ^|')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('rewrites two consumed definitions in one list', () => {
    const result = upgrade('* [d]:\n* [e]:\n')
    expect(result.output).toBe('* {% %}\n* {% %}\n')
    expect(result.check).toBe('pass')
  })
})
