import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-092, U-170: a trailing hyphen in a parsed tag or mention', () => {
  it.each(['#x-', '@a-'])('reports the HTML difference with a source range: %s', (source) => {
    const result = upgrade(source)
    expect(result.output).toBe(source)
    expect(result.check).toBe('explained')
    const report = result.records.find((record) => record.entry === 'U-170')
    expect(report?.range).toEqual({ startOffset: 0, endOffset: source.length })
  })

  it('composes with the parsed U-365 deletion rewrite', () => {
    const result = upgrade('{-{#x-}\n\n#x-\n')
    expect(result.output).toBe('{-\\{#x-}\n\n#x-\n')
    expect(result.check).toBe('explained')
    expect(result.records.map((record) => record.entry)).toContain('U-170')
  })

  it('checks multiple parsed trailing names in one paragraph', () => {
    const result = upgrade('see #x- and @a-')
    expect(result.check).toBe('explained')
    expect(result.records.filter((record) => record.entry === 'U-170')).toHaveLength(2)
  })

  it.each(['`#x-`', '```\n@a-\n```'])('leaves code content unchanged: %s', (source) => {
    expect(upgrade(source).output).toBe(source)
  })
})
