import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-I-052 mixed delimiter reports', () => {
  it('U-273 writes the delimiters 0.1 read in _*`/`/*a*/ explicitly', () => {
    const result = upgrade('_*`/`/*a*/\n')
    expect(result.output).toBe('\\_{*`/`\\/\\*a*}\\/\n')
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-273')
  })
  it.each([
    ['/*a %% b*/ y\n', '*/a{% b%}/* y\n'],
    ['*x /*a %% b*/ y*\n', '*x /\\*a{% b%}*/ y*\n'],
    ['/x /*a %% b*/ y\n', '/x \\/*a{% b%}*/ y\n'],
  ])('U-432 braces the comment 0.1 ended at the closer of %j', (source, output) => {
    const result = upgrade(source)
    expect(result.output).toBe(output)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-432')
  })
})
