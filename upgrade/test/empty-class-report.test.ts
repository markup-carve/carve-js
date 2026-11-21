import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-042, U-282: an empty parsed class token', () => {
  it.each(['{class=""}\npara\n', '{class=" "}\npara\n', '[x]{class=""}\n'])
  ('reports and verifies the missing class: %s', (source) => {
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('explained')
    const report = result.records.find((record) => record.entry === 'U-282')
    expect(report?.range?.startOffset).toBeGreaterThanOrEqual(0)
    expect(report?.range?.endOffset).toBeGreaterThan(0)
  })

  it('does not cite a class token inside code beside an unrelated table difference', () => {
    const source = '```\n{class=""}\n```\n\n{aligns="right,,center" widths="25,50,25"}\n| A | B | C |\n'
    const result = upgrade(source)
    expect(result.output.slice(0, 18)).toBe(source.slice(0, 18))
    expect(result.records.map((record) => record.entry)).not.toContain('U-282')
  })
})
