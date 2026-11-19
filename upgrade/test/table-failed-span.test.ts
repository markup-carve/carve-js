import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-172 C2-B-173: failed span in a header cell', () => {
  it('C2-B-174, U-259: a first-row span mark is a header cell that holds the mark, so the empty cell of 0.1 is written', () => {
    const result = upgrade('|= ^|')
    expect(result.output).toBe('|= |')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toEqual(['U-259'])
  })

  it('C2-I-017, U-258: a backtick run with no closing run is closed where 0.1 ended the code', () => {
    const result = upgrade('a `b c\n')
    expect(result.output).toBe('a `b c`\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toEqual(['U-258'])
  })

  it('keeps an unrelated delimiter difference as a mismatch beside a table alignment list', () => {
    const result = upgrade('/*a %% `*/` b*/ c\n\n{valigns=top,bottom widths=40}\n| a | b | c |')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
