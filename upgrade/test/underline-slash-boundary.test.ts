import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-046 through C2-I-048 underline and slash boundary', () => {
  it('U-065 escapes the slash that 0.1 left literal', () => {
    const result = upgrade('_z_/y/\n')
    expect(result.output).toBe('{_z_}\\/y/\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-065')
  })

  it('C2-I-046 leaves an engine violation of braced underline parsing visible', () => {
    const result = upgrade('={_a=b_}\n')
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })
})
