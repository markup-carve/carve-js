import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-069 substitution comment boundary', () => {
  it('escapes a comment mark kept as text by the 0.1 substitution parse', () => {
    const result = upgrade('{~%% b~>x~}\n')
    expect(result.output).toBe('{-\\%% b-}{+x+}\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-069')
  })

  it('leaves an ordinary substitution and a code payload alone', () => {
    expect(upgrade('{~a~>x~}\n').output).toBe('{-a-}{+x+}\n')
    expect(upgrade('`{~%% b~>x~}`\n').output).toBe('`{~%% b~>x~}`\n')
  })
})
