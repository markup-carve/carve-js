import { describe, expect, it } from 'vitest'
import { formatWithDiagnostics, parse, writeWithDiagnostics } from '../public/index.ts'

// carve-js#5771: a comment body line that is a bare colon run closes the line block (C2-B-123), so it has no spelling.
describe('C2-W-117, C2-W-039: a comment block in a line block whose value line closes the block (carve-js#5771)', () => {
  it.each([
    '::: |\n%%% :::\n:::\n',
    '::: |\na\n%%%% :::\n:::\n',
    '::: |\n  %%% ::::\n:::\n',
    '- ::: |\n  %%% :::\n  :::\n',
  ])('reports field-unspellable at the value of %j', (source) => {
    const path = source.startsWith('- ') ? '/children/0/children/0/children/0/children' : '/children/0/children'
    const { diagnostics } = formatWithDiagnostics(source)
    const loss = diagnostics.filter((entry) => entry.code === 'field-unspellable')
    expect(loss).toHaveLength(1)
    expect(loss[0]!.path.startsWith(path) && loss[0]!.path.endsWith('/value')).toBe(true)
  })

  it('reports it for a supplied tree', () => {
    const { diagnostics } = writeWithDiagnostics(parse('::: |\n%%% :::\n:::\n'))
    expect(diagnostics.map((entry) => [entry.code, entry.path])).toContainEqual(['field-unspellable', '/children/0/children/0/value'])
  })

  it.each([
    '::: |\n%%%\n::: x\n%%%\n:::\n',
    '::: |\n%%%\n::\n%%%\n:::\n',
    '::: d\n%%%\n:::\n:::\n%%%\n:::\n',
  ])('keeps writing a value that closes nothing, %j', (source) => {
    const { source: written, diagnostics } = formatWithDiagnostics(source)
    expect(diagnostics.filter((entry) => entry.channel === 'render-loss')).toEqual([])
    expect(written).toBe(source)
  })
})
