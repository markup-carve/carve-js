import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-059 C2-B-087 footnote fence continuation', () => {
  it('moves a real fenced code block into its footnote', () => {
    const source = ['[^a]: +', '```', 'x', '```', '', 'see[^a]', ''].join('\n')
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.output).toBe(['[^a]: ```', '  x', '  ```', '', 'see[^a]', ''].join('\n'))
    expect(result.records.map((record) => record.entry)).toContain('U-124')
  })
})
