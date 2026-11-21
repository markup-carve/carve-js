import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-025 C2-B-140, U-362: a short comment line after a blank in an item', () => {
  it('cites the parsed comment that 0.2 moves out of the nested item', () => {
    const source = '- a\n  - b\n\n   {%%}\n    - b\n'
    const result = upgrade(source)
    expect(result.check).toBe('mismatch')
    const report = result.records.find((record) => record.entry === 'U-362')
    expect(report?.range).toEqual({ startOffset: 14, endOffset: 18 })
  })

  it('does not cite a comment spelling inside code', () => {
    const source = '- a\n  - b\n\n   ```\n   {%%}\n   ```\n    - b\n'
    expect(upgrade(source).records.map((record) => record.entry)).not.toContain('U-362')
  })

  it('keeps a comment at the item content column clear', () => {
    const source = '- a\n  - b\n\n    {%%}\n    - b\n'
    expect(upgrade(source).records.map((record) => record.entry)).not.toContain('U-362')
  })
})
