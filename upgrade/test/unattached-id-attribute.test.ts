import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('U-275: a brace around a 0.1 tag', () => {
  it('escapes the unattached attribute form anywhere in paragraph text', () => {
    const result = upgrade('left {#q} right\n')
    expect(result.output).toBe('left \\{#q} right\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-275')
  })

  it('does not escape code content or an attribute attached to a span', () => {
    for (const source of ['`left {#q} right`\n', '[left]{#q} right\n']) {
      expect(upgrade(source).output).toBe(source)
    }
  })

  it('escapes the brace before a 0.1 tag after an escaped attribute (U-256)', () => {
    const result = upgrade('Text[^a]\\{.c}{#i}.\n')
    expect(result.output).toBe('Text[^a]\\{.c}\\{#i}.\n')
    expect(result.check).toBe('pass')
  })
})
