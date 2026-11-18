import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('U-258: an unclosed 0.1 inline run', () => {
  it.each(['$`\n', '$$``\n', '`\n'])(
    'reports an empty value that a closing run cannot spell: %s', (source) => {
      const result = upgrade(source)
      expect(result.output).toBe(source)
      expect(result.check).toBe('mismatch')
      expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-258', class: 'report', line: 1,
        range: { startOffset: 0, endOffset: source.trimEnd().length } }))
    },
  )

  it('closes a nonempty math run using its 0.1 parse position', () => {
    const result = upgrade('$`x\n')
    expect(result.output).toBe('$`x`\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-258')
  })

  it('leaves the same bytes inside a fenced code block', () => {
    const source = '```\n$`x\n```\n'
    expect(upgrade(source).output).toBe(source)
  })
})
