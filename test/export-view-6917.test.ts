import { describe, expect, it } from 'vitest'
import { parse } from '../src/api.ts'
import { toAnsi, toMarkdown, toPlainText } from '../src/export/index.ts'
import { withSnippetLimits } from '../src/harness-limits.ts'

const exports = [toMarkdown, toPlainText, toAnsi] as const

describe('exports read the resolved render view (carve#6917)', () => {
  it('expands inline and block uses, including a nested use, without changing the supplied tree', () => {
    const tree = parse('{$inner}: X\n{$outer}: A {{ $inner }}.\n\n{{ $outer }}\n\nB {{ $inner }}.\n')
    const original = JSON.stringify(tree)
    for (const run of exports) {
      expect(run(tree).output).toContain('A X.')
      expect(run(tree).output).toContain('B X.')
      expect(JSON.stringify(tree)).toBe(original)
    }
  })

  it('writes unresolved and refused uses as their source spelling and reports each loss', () => {
    const source = '{$long}: ABCDEFGHIJ\n{$short}: X\n\nA {{ $long }} {{ $short }} {{ $missing }}.\n'
    for (const run of exports) {
      const result = withSnippetLimits({ derivedTextBytes: 40 }, () => run(parse(source)))
      expect(result.output).toBe('A {{ $long }} X {{ $missing }}.\n')
      expect(result.diagnostics.map((item) => item.code)).toEqual(['derived-text-budget', 'snippet-unresolved'])
    }
  })

  it('charges snippet copies before later abbreviation expansions', () => {
    const tree = parse('{$v}: X\n\n{{ $v }} A\n\n*[A]: long\n')
    for (const run of exports) {
      const result = withSnippetLimits({ derivedTextBytes: 39 }, () => run(tree))
      expect(result.output.split('\n')[0]).toBe('X A')
      expect(result.diagnostics.map((item) => item.code)).toEqual(['derived-text-budget'])
    }
  })
})
