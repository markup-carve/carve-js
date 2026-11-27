import { describe, expect, it } from 'vitest'
import { parse } from '../src/api.ts'
import { toAnsi, toMarkdown, toPlainText } from '../src/export/index.ts'
import { withSnippetLimits } from '../src/harness-limits.ts'

describe('an oversized derived item leaves the remaining budget (carve#6918)', () => {
  it('lets a later abbreviation that fits expand in every target, reporting only the first loss', () => {
    const tree = parse('A B C\n\n*[A]: xxxxx\n*[B]: yyy\n*[C]: z\n')
    for (const [index, run] of [toMarkdown, toPlainText, toAnsi].entries()) {
      const result = withSnippetLimits({ derivedTextBytes: 6 }, () => run(tree))
      const firstLine = result.output.split('\n')[0]!
      expect(firstLine).toBe(index === 0 ? '<abbr title="xxxxx">A</abbr> B <abbr title="z">C</abbr>' :
        index === 1 ? 'A (xxxxx) B C (z)' : 'A\x1b[2m (xxxxx)\x1b[0m B C\x1b[2m (z)\x1b[0m')
      expect(result.diagnostics.map((item) => item.code)).toEqual(['derived-text-budget'])
    }
  })
})
