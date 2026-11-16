import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-032 C2-B-059 C2-I-015: quote continuation beside a code span', () => {
  // C2-I-017: a run with no closer of its length is text in 0.2, so no empty quote line keeps the 0.1 code span.
  it.each([
    ['> +\n: ```\n> q\n', '> : ```\n> q\n'],
    ['> +\n: ``` js\n> q\n', '> : ``` js\n> q\n'],
    ['> +\n: ````\n> q```\n', '> : ````\n> q```\n'],
  ])('C2-I-017: an unclosed code span after a quote plus has no preserving spelling: %s', (source, expected) => {
    const result = upgrade(source)
    expect(result.output).toBe(expected)
    expect(result.check).toBe('mismatch')
    expect(result.records.map((record) => record.entry)).toContain('upgrade-mismatch')
  })

  it('leaves an unrelated table defect as a mismatch', () => {
    expect(upgrade('> +\n: ```\n> q\n\n{valigns=top,bottom widths=40}\n| a | b | c |').check).toBe('mismatch')
  })
})
