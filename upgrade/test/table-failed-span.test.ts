import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-172 C2-B-173: failed span in a header cell', () => {
  it('leaves the engine difference unverified', () => {
    const result = upgrade('|= ^|')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('also keeps an unrelated delimiter difference as a mismatch', () => {
    const result = upgrade('/***/\n\n|= ^|')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
