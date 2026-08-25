import { describe, expect, it } from 'vitest'
import { inspectColonFences, lintCarve } from '../src/index.js'

const mismatches = (source: string) => lintCarve(source).filter((d) => d.rule === 'colon-fence-length-mismatch')

describe('colon fence tooling', () => {
  it('diagnoses a near bare closer with structural details', () => {
    const [warning] = mismatches(':::: note\nbody\n:::\n')
    expect(warning?.data).toEqual({ authoredWidth: 3, expectedWidth: 4, openerLine: 1, openerColumn: 1, outcome: 'nested container' })
    expect(warning?.message).toContain('opened at 1:1')
  })

  it('pairs exact closers and leaves them clean', () => {
    const inspected = inspectColonFences(':::: note\nbody\n::::\n')
    expect(inspected.mismatches).toEqual([])
    expect(inspected.pairs).toHaveLength(1)
  })

  it('does not diagnose a deliberate child with its own closer', () => {
    expect(mismatches(':::: note\n::: \nchild\n:::\n::::\n')).toEqual([])
  })

  it('ignores colon runs in code, raw, and comment payloads', () => {
    for (const source of [
      ':::: note\n```\n:::\n```\n::::\n',
      ':::: note\n```=html\n:::\n```\n::::\n',
      ':::: note\n%%%\n:::\n%%%\n::::\n',
    ]) expect(mismatches(source)).toEqual([])
  })

  it('does not diagnose typed or escaped lines', () => {
    expect(mismatches(':::: note\n::: tip\nx\n:::\n::::\n')).toEqual([])
    expect(mismatches(':::: note\n\\:::\n::::\n')).toEqual([])
  })

  it('uses parser ownership for an over-indented fence in a list item', () => {
    const [warning] = mismatches('- item\n\n    :::: note\n    body\n    :::\n')
    expect(warning?.data).toMatchObject({ expectedWidth: 4, openerLine: 3, openerColumn: 5 })
  })
})
