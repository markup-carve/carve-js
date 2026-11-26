import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/upgrade.ts'

describe('U-267 underline attribute boundary', () => {
  it('escapes an equals sign that would make the braced underline an attribute', () => {
    const result = upgrade('x _a=b_ y\n')
    expect(result.output).toBe('x {_a\\=b_} y\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-267')
  })

  it('does not escape a near miss or content inside code and comments', () => {
    expect(upgrade('x _a b_ y\n').output).toBe('x {_a b_} y\n')
    for (const source of ['`_a=b_`\n', '{% _a=b_ %}\n']) expect(upgrade(source).output).toBe(source)
  })
})
