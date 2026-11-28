import { describe, expect, it } from 'vitest'
import { format, parse, write } from '../public/index.ts'
import { treesEqual } from '../src/index.ts'

// carve#6944: the backslash goes before the first mark of the fence run, behind the spaces C2-B-130 keeps (C2-W-090).
describe('C2-W-002, C2-W-090: a fence run behind the leading spaces of a line of a line block (carve#6944)', () => {
  const kept = [
    '::: |\n  \\%%%\n:::\n',
    '::: |\n  \\:::\n:::\n',
    '::: |\n \\%%%% x\n:::\n',
    '::: |\n      \\::::\n:::\n',
    '::: |\na\n   \\:::\nb\n:::\n',
    '- ::: |\n     \\%%%\n  :::\n',
    '> ::: |\n>   \\:::\n> :::\n',
    ':::: d\n::: |\n  \\:::\n:::\n::::\n',
  ]

  it.each(kept)('formats %j unchanged', (source) => {
    expect(format(source)).toBe(source)
  })

  it('writes the migrated tree of 0.1 corpus row 867-3', () => {
    const source = '::: |\n    \\%%%\n  x\n    \\%%%\n:::\n'
    expect(write(parse(source))).toBe(source)
  })

  it('writes the migrated tree of 0.1 corpus row 914-3', () => {
    const source = '- :: u\n  : ::: |\n     [x]: /u\n    - l\n       \\:::\n    b\n    :::\n'
    const written = write(parse(source))
    expect(written).toBe(source)
    expect(treesEqual(parse(written), parse(source))).toBe(true)
  })

  it('keeps the escape at column 0 as before', () => {
    expect(format('::: |\n\\:::\n:::\n')).toBe('::: |\n\\:::\n:::\n')
    expect(format('::: |\n\\%%%\n:::\n')).toBe('::: |\n\\%%%\n:::\n')
  })
})
