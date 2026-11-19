import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-123 C2-B-130, U-130: a lazy line in a parsed line block', () => {
  it('keeps the 0.1 tag of the lazy line, which was the only difference (U-256)', () => {
    const source = ':: t\n: > - ::: |\n  >   {#i}\nb\n'
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.output).toBe(':: t\n: > - ::: |\n  >   \\{#i}\nb\n')
  })

  it('does not cite the same spelling inside code', () => {
    const source = '```\n:: t\n: > - ::: |\n  >   {#i}\nb\n```\n'
    expect(upgrade(source).records.map((record) => record.entry)).not.toContain('U-130')
  })
})
