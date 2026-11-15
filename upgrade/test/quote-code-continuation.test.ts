import { describe, expect, it } from 'vitest'
import { upgrade } from '../src/index.ts'

describe('C2-B-032 C2-B-059 C2-I-015: quote continuation beside a code span', () => {
  it.each([
    ['> +\n: ```\n> q\n', '> : ```\n>\n> q\n'],
    ['> +\n: ``` js\n> q\n', '> : ``` js\n>\n> q\n'],
    ['> +\n: ````\n> q```\n', '> : ````\n>\n> q```\n'],
  ])('separates quote paragraphs after a code span: %s', (source, expected) => {
    const result = upgrade(source)
    expect(result.output).toBe(expected)
    expect(result.check).toBe('pass')
    expect(result.records.map((record) => record.entry)).toContain('U-125')
  })

  it('leaves an unrelated table defect as a mismatch', () => {
    expect(upgrade('> +\n: ```\n> q\n\n{valigns=top,bottom widths=40}\n| a | b | c |').check).toBe('mismatch')
  })
})
