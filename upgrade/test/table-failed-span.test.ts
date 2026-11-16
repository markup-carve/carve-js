import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-172 C2-B-173: failed span in a header cell', () => {
  it('C2-B-174: a first-row span mark is a header cell that holds the mark, unlike the empty cell of 0.1', () => {
    const result = upgrade('|= ^|')
    expect(result.output).toBe('|= ^|')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('keeps an unrelated delimiter difference as a mismatch beside a table alignment list', () => {
    const result = upgrade('/***/\n\n{valigns=top,bottom widths=40}\n| a | b | c |')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
