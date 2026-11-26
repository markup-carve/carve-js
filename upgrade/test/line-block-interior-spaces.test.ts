import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-265 line block spaces', () => {
  // carve#6762 (C2-H-043): 0.2 writes an interior run of two or more spaces as `&nbsp;`, as 0.1 did.
  it('leaves interior space runs of a line block as they are', () => {
    const source = '::: |\nA  B and  C\nD  E\n:::\n'
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).not.toContain('U-265')
  })

  it('leaves ordinary paragraph and code payload spaces alone', () => {
    for (const source of ['A  B\n', '```\nA  B\n```\n', '::: |\nA  \n:::\n']) {
      expect(upgrade(source).output).toBe(source)
    }
  })
})
