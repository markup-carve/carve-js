import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-274 same-kind delimiters under a 0.1 braced span', () => {
  it('escapes the bare child delimiters that the 0.1 tree kept as text', () => {
    const result = upgrade('{*x *y* z*}\n')
    expect(result.output).toBe('{*x \\*y\\* z*}\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-274')
  })

  it('leaves a code child and an unlike kind alone', () => {
    for (const source of ['{*x `*y*` z*}\n', '{*x /y/ z*}\n']) expect(upgrade(source).output).toBe(source)
  })
})
