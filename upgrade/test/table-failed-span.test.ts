import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-172 C2-B-173: failed span in a header cell', () => {
  it('reads as the empty header cell of 0.1, so the text is left alone', () => {
    const result = upgrade('|= ^|')
    expect(result.output).toBe('|= ^|')
    expect(result.check).toBe('pass')
    expect(result.records).toEqual([])
  })

  it('keeps an unrelated delimiter difference as a mismatch beside a table alignment list', () => {
    const result = upgrade('/***/\n\n{valigns=top,bottom widths=40}\n| a | b | c |')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
