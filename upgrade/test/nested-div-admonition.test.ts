import { describe, expect, it } from 'vitest'
import { canWriteUpgrade, upgrade } from '../src/index.ts'

const sources = [
  '::: note\n> para\n> [r]: /u\n``\ncode\n::::\n:::\ntext\nafter *b*\n',
  '::: note\n> para\n[r][d]```\n> [r]: /u\ncode\n::::\n:::\nafter *b*\n',
  '\n::: note\n> para\n> [r]: /u\n`!`z```\ncode\n::::\n:::\nafter *b*\n',
]

describe('the old admonition owning a nested div', () => {
  it.each(sources)('writes the complete old HTML for %j', (source) => {
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(canWriteUpgrade(result)).toBe(true)
    expect(result.output).toContain('::::: note')
    expect(result.records.map(({ entry }) => entry)).toContain('U-038')
    expect(result.records.map(({ entry }) => entry)).toContain('U-049')
    expect(result.records.map(({ entry }) => entry)).toContain('U-258')
  })

  it('moves the positioned definition when a label already appeared above it', () => {
    const source = `[r]: /first\n\n${sources[0]}`
    const result = upgrade(source)
    expect(result.check).toBe('pass')
    expect(result.output.startsWith('[r]: /u\n\n[r]: /first\n')).toBe(true)
  })
})
