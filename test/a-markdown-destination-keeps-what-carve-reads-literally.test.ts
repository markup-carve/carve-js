import { describe, expect, it } from 'vitest'
import { migrateMarkdown, renderCarve } from '../src/index.js'

const rows: Array<[string, string, string, string[]?]> = [
  ['D1', String.raw`[a](/x\y) [b](/a` + '`b) [c](/a^b{c}) [d](/a"b) [e](/a<b>)', String.raw`[a](/x\y) [b](/a` + '`b) [c](/a^b{c}) [d](/a"b) [e](/a<b>)', ['markdown-paragraph', ...Array(5).fill('markdown-link')]],
  ['D2', String.raw`[e](/x\\)`, String.raw`[e](/x\\)`, ['markdown-paragraph', 'markdown-link']],
  ['D3', String.raw`[f](</a\\(>)`, String.raw`[f](/a\\\()`, ['markdown-paragraph', 'markdown-link']],
  ['D4', String.raw`[g](/a\\\\b)`, String.raw`[g](/a\\\b)`, ['markdown-paragraph', 'markdown-link']],
  ['D5', String.raw`[a](</x)(a>) [b](</x(a))>) [c](</x((a)>) [d](</x\\(a)>)`, String.raw`[a](/x\)\(a) [b](/x(a)\)) [c](/x\((a)) [d](/x\\(a))`, ['markdown-paragraph', ...Array(4).fill('markdown-link')]],
  ['D6', '[a](/x(a))', '[a](/x(a))', ['markdown-paragraph', 'markdown-link']],
  ['D7', '[a][r]\n\n[r]: /x`y', '[a][r]\n\n[r]: /x`y', ['markdown-paragraph', 'markdown-reference-link', 'markdown-reference-definition']],
  ['D8', '![a](/p^q.png)', '![a](/p^q.png)', ['markdown-paragraph', 'markdown-image']],
  ['D9', String.raw`| h |
| --- |
| [a](/x\|y) z |`, String.raw`|= h |
| [a](/x%7Cy) z |`],
  ['A1', String.raw`<https://example.com/\[\>`, String.raw`[https://example.com/\\\[\\](https://example.com/\[\\)`, ['markdown-paragraph', 'markdown-autolink']],
  ['A2', String.raw`<https://e.com/a\b>`, String.raw`[https://e.com/a\\b](https://e.com/a\b)`, ['markdown-paragraph', 'markdown-autolink']],
  ['A3', '<https://e.com/a`b>', '[https://e.com/a\\`b](https://e.com/a`b)', ['markdown-paragraph', 'markdown-autolink']],
  ['A4', '<http://u/[^a|b]>\n\n[^a|b]: Note.', String.raw`[http://u/\[^a|b\]](http://u/[^a|b])` + '\n\n[^carve-import-footnote-1]: Note.'],
  ['A5', 'http://\u2028a.b', '[http://\u2028a.b](http://%E2%80%A8a.b)'],
  ['E1', 'see https://example.com/[a]b here', 'see [https://example.com/[a]b](https://example.com/[a]b) here', ['markdown-paragraph', 'markdown-bare-autolink']],
  ['E2', 'see https://e.com/ü here', 'see [https://e.com/ü](https://e.com/ü) here', ['markdown-paragraph', 'markdown-bare-autolink']],
  ['E3', 'www.example.com/a[b]c', '[www.example.com/a[b]c](http://www.example.com/a[b]c)', ['markdown-paragraph', 'markdown-bare-autolink']],
  ['E4', 'https://e.com/a]b', String.raw`[https://e.com/a\]b](https://e.com/a]b)`, ['markdown-paragraph', 'markdown-bare-autolink']],
  ['E5', 'see https://e.com/[x](y) z', String.raw`see [https://e.com/[x]\(y)](https://e.com/[x](y)) z`, ['markdown-paragraph', 'markdown-bare-autolink']],
  ['E6', 'https://x.test/a\u00a0b', '[https://x.test/a\u00a0b](https://x.test/a%C2%A0b)', ['markdown-paragraph', 'markdown-bare-autolink']],
  ['T1', String.raw`| <https://example.com/a\|b> | z |` + '\n|---|---|', String.raw`|= [https://example.com/a\|b](https://example.com/a%7Cb) |= z |`],
  ['T2', String.raw`| <http://x/a\|b> | z |` + '\n|---|---|', String.raw`|= [http://x/a\|b](http://x/a%7Cb) |= z |`],
  ['T3', String.raw`| <http://x/a\\|b> | z |` + '\n|---|---|', String.raw`|= [http://x/a\\\|b](http://x/a\%7Cb) |= z |`],
  ['F1', '[x <https://e.com/a]b> y](/u)', '[x <https://e.com/a]b> y](/u)'],
]

describe('_expect2 destination rulings', () => {
  it.each(rows)('%s', (name, source, output, codes) => {
    const result = migrateMarkdown(source + '\n')
    expect(result.value).toBe(output + '\n')
    if (codes) {
      expect(result.report.diagnostics.map(row => row.code)).toEqual(codes)
      expect(result.report.diagnostics.map(row => row.fidelity)).toEqual(codes.map((code, i) => i === 0 || (name.startsWith('D') && !code.includes('reference')) ? 'preserved' : 'normalized'))
      expect(result.report.diagnostics.map(row => row.path)).toEqual(codes.map((code) => code === 'markdown-reference-definition' ? 'line:3' : 'line:1'))
      expect(result.report.diagnostics.every(row => row.severity === 'info')).toBe(true)
    }
  })

  it('keeps the controls', () => {
    expect(migrateMarkdown('[a](/x&amp;y)\n').report.diagnostics[0]?.code).toBe('fidelity-unverified')
    expect(migrateMarkdown('<https://e.com/a[b]>\n').value).toBe('<https://e.com/a[b]>\n')
    expect(migrateMarkdown('[a](/ü.png)\n').value).toBe('[a](/ü.png)\n')
  })

  it('keeps the link around an autolink, and text that only looks like one stays text', () => {
    const result = migrateMarkdown('[x <https://e.com/a]b> y](/u)\n')
    expect(result.value).toBe('[x <https://e.com/a]b> y](/u)\n')
    expect(result.report.diagnostics[0]?.code).toBe('fidelity-unverified')
    expect(renderCarve({ type: 'document', children: [{ type: 'paragraph', children: [
      { type: 'text', value: '[x ' },
      { type: 'autolink', href: 'https://e.com/a]b', text: 'https://e.com/a]b' },
      { type: 'text', value: ' y](/u)' },
    ] }] })).toBe(String.raw`[x <https://e.com/a]b> y]\(/u)` + '\n')
  })
})
