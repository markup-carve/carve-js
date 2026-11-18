import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('U-258: an unclosed 0.1 inline run', () => {
  it.each(['$`\n', '$$``\n'])(
    'reports an empty value that a closing run cannot spell: %s', (source) => {
      const result = upgrade(source)
      expect(result.output).toBe(source)
      expect(result.check).toBe('explained')
      expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-396', class: 'report', line: 1,
        range: { startOffset: 0, endOffset: source.trimEnd().length } }))
    },
  )

  it('retains the plain unclosed code run under U-258', () => {
    const result = upgrade('`\n')
    expect(result.output).toBe('`\n')
    expect(result.check).toBe('explained')
    expect(result.records).toContainEqual(expect.objectContaining({ entry: 'U-258', class: 'report', line: 1,
      range: { startOffset: 0, endOffset: 1 } }))
  })

  it('closes a nonempty math run using its 0.1 parse position', () => {
    const result = upgrade('$`x\n')
    expect(result.output).toBe('$`x`\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-258')
  })

  it('explains two empty parsed runs without changing the source', () => {
    const source = '$`\n\n$$``\n'
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('explained')
    expect(result.records.filter((record) => record.entry === 'U-396')).toHaveLength(2)
  })

  it('leaves the same bytes inside a fenced code block', () => {
    const source = '```\n$`x\n```\n'
    expect(upgrade(source).output).toBe(source)
  })

  it('keeps an authored closed run distinct from the empty report case', () => {
    const result = upgrade('$` x`\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).not.toContain('U-258')
  })
})
