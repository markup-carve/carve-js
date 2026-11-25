import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('U-258: a run closed right after a backslash (carve-js#5626)', () => {
  // A backslash is text inside a code, math or literal run in 0.1 and 0.2, so the run after it closes.
  it.each([
    'such as `{*}\\`, no panic.\n',
    'a `\\` b\n',
    'a ``x\\`` b\n',
    'a $`x\\` b\n',
    'a $$`x\\` b\n',
    'a !`x\\` b\n',
    '- a `x\\` b\n',
    '> a `x\\`\n',
  ])('leaves %j unchanged', (source) => {
    const result = upgrade(source)
    expect([result.output, result.check, result.records.map(({ entry }) => entry).filter((entry) => entry !== 'U-079')])
      .toEqual([source, 'pass', []])
  })

  it('still closes a run whose only later run is wider', () => {
    const result = upgrade('a `x\\`` b\n')
    expect([result.output, result.check]).toEqual(['a `x\\`` b`\n', 'pass'])
    expect(result.records.map(({ entry }) => entry)).toContain('U-258')
  })
})
