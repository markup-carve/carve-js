import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-265 line block spaces', () => {
  it('escapes each interior space in each parsed line', () => {
    const source = '::: |\nA  B and  C\nD  E\n:::\n'
    const result = upgrade(source)
    expect(result.output).toBe('::: |\nA\\ \\ B and\\ \\ C\nD\\ \\ E\n:::\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-265')
  })

  it('leaves ordinary paragraph and code payload spaces alone', () => {
    for (const source of ['A  B\n', '```\nA  B\n```\n', '::: |\nA  \n:::\n']) {
      expect(upgrade(source).output).toBe(source)
    }
  })
})
