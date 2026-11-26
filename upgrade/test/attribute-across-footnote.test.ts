import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

describe('old floating attributes across a footnote definition', () => {
  it('keeps the attribute on its old paragraph', () => {
    const source = ':: t\n:  - a\n {#i}\n    [^n]: note text\n \nSee [^n].\n'
    const result = upgrade(source)
    expect(result.output).toBe(':: t\n:  - a\n\n[^n]: note text\n \n{#i}\nSee [^n].\n')
    expect(result.check).toBe('pass')
    expect(canWriteUpgrade(result)).toBe(true)
    expect(result.records.map(({ entry }) => entry)).not.toContain('upgrade-conflict')
  })
})
