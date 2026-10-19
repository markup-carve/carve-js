import { describe, expect, it } from 'vitest'
import { migrateMarkdown } from '../src/index.js'

const cases: Array<[string, string, string, Array<[string, string, number]>]> = [
  ['A1', String.raw`<https://example.com/\[\>`, String.raw`[https://example.com/\\\[\\](https://example.com/%5C[%5C)`, [['markdown-paragraph', 'preserved', 1], ['markdown-autolink', 'normalized', 1]]],
  ['A2', String.raw`<https://e.com/a\b>`, String.raw`[https://e.com/a\\b](https://e.com/a%5Cb)`, [['markdown-paragraph', 'preserved', 1], ['markdown-autolink', 'normalized', 1]]],
  ['A3', '<https://e.com/a`b>', String.raw`[https://e.com/a\`b](https://e.com/a%60b)`, [['markdown-paragraph', 'preserved', 1], ['markdown-autolink', 'normalized', 1]]],
  ['A4', '<https://e.com/a[b]>', '<https://e.com/a[b]>', [['markdown-paragraph', 'preserved', 1], ['markdown-autolink', 'normalized', 1]]],
  ['B1', '[a](<😀>) and ![b](</x y.png>)', '[a](😀) and ![b](/x%20y.png)', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1], ['markdown-image', 'preserved', 1]]],
  ['B2', '[a](</x>)', '[a](/x)', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B3', '[a](<x y>)', '[a](x%20y)', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B4', '[a](<x[y]>)', '[a](x[y])', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B5', '[a](<x> "t")', '[a](x "t")', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B6', '[a](<x)y>)', String.raw`[a](x\)y)`, [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B7', '[a](<>)', '[a]()', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B8', String.raw`[a](<\>>)`, '[a](%3E)', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B9', String.raw`[a](<x\\y>)`, '[a](x%5Cy)', [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B10', String.raw`[a](/x\(y)`, String.raw`[a](/x\(y)`, [['markdown-paragraph', 'preserved', 1], ['markdown-link', 'preserved', 1]]],
  ['B11', '[a][r]\n\n[r]: <x y>', '[a][r]\n\n[r]: x%20y', [['markdown-paragraph', 'preserved', 1], ['markdown-reference-link', 'normalized', 1], ['markdown-reference-definition', 'normalized', 3]]],
  ['C1', 'see https://example.com/[a]b here', 'see [https://example.com/[a]b](https://example.com/%5Ba%5Db) here', [['markdown-paragraph', 'preserved', 1], ['markdown-bare-autolink', 'normalized', 1]]],
  ['C2', 'www.example.com/a[b]c', '[www.example.com/a[b]c](http://www.example.com/a%5Bb%5Dc)', [['markdown-paragraph', 'preserved', 1], ['markdown-bare-autolink', 'normalized', 1]]],
  ['C3', 'https://e.com/a]b', String.raw`[https://e.com/a\]b](https://e.com/a%5Db)`, [['markdown-paragraph', 'preserved', 1], ['markdown-bare-autolink', 'normalized', 1]]],
  ['C4', 'https://e.com/a[b', String.raw`[https://e.com/a\[b](https://e.com/a%5Bb)`, [['markdown-paragraph', 'preserved', 1], ['markdown-bare-autolink', 'normalized', 1]]],
]

describe('Markdown destination divergences', () => {
  it.each(cases)('%s', (_name, source, output, expected) => {
    const result = migrateMarkdown(source + '\n')
    expect(result.value).toBe(output + '\n')
    expect(result.report.diagnostics.map(({ code, fidelity, path }) => [code, fidelity, path])).toEqual(expected.map(([code, fidelity, line]) => [code, fidelity, `line:${line}`]))
    expect(result.report.diagnostics.every(({ confidence, severity }) => confidence === 'exact' && severity === 'info')).toBe(true)
  })

  it('keeps destination entities unverified', () => {
    const result = migrateMarkdown('[a](/x&amp;y)\n')
    expect(result.value).toBe('[a](/x&y)\n')
    expect(result.report.diagnostics.map(({ code, fidelity }) => [code, fidelity])).toEqual([['fidelity-unverified', 'dropped']])
  })

  it('keeps the table pipe encoded and brackets literal in autolink fallbacks', () => {
    const result = migrateMarkdown(String.raw`| h |
| --- |
| <https://e.com/a\|b\[> |` + '\n')
    expect(result.value).toContain('(https://e.com/a%7Cb%5C[)')
  })

  it('keeps brackets literal in a protected reference autolink fallback', () => {
    const result = migrateMarkdown(String.raw`[r]: <https://e.com/a\[\> "t"` + '\n')
    expect(result.value).toContain('(https://e.com/a%5C[%5C)')
  })
})
