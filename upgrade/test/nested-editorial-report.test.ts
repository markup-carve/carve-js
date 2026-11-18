import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-058 C2-I-059, U-374: nested editorial closer ownership', () => {
  it.each(['{-{_a-}_} b-}', '{-{-a-}-} b-}'])('cites the parsed outer span: %s', (source) => {
    const result = upgrade(source)
    expect(result.check).toBe('mismatch')
    const report = result.records.find((record) => record.entry === 'U-374')
    expect(report?.range?.startOffset).toBe(0)
    expect(report?.range?.endOffset).toBeGreaterThan(0)
  })

  it('does not cite a nested spelling inside code', () => {
    const source = '```\n{-{_a-}_} b-}\n```\n\n{aligns="right,,center" widths="25,50,25"}\n| A | B | C |\n'
    const result = upgrade(source)
    expect(result.output.slice(0, 22)).toBe(source.slice(0, 22))
    expect(result.records.map((record) => record.entry)).not.toContain('U-374')
  })
})
