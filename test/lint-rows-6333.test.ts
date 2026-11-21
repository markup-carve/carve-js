import { describe, expect, it } from 'vitest'
import { lint } from '../lint/lint.ts'

// The rows of markup-carve/carve#6335, past the clause cases CC-1542 to CC-1549 they pin.
const cases: readonly [string, string, readonly [number, number][]][] = [
  ['definition-term-block-folded', ':: > x', [[3, 4]]],
  ['definition-term-block-folded', ':: 12. a', [[3, 6]]],
  ['definition-term-block-folded', ': - a', []],
  ['definition-term-block-folded', ':: 3) a\n: d', [[3, 5]]],
  ['definition-term-block-folded', ':: >x', []],
  ['github-alert-marker', '>* > [!NOTE]', []],
  ['github-alert-marker', '>- > [!NOTE]', []],
  ['github-alert-marker', '>[x]: > [!NOTE]', []],
  ['github-alert-marker', '  >a > [!TIP]', []],
  ['github-alert-marker', '>[!NOTE]', [[1, 8]]],
  ['github-alert-marker', '> > [!NOTE]', [[4, 11]]],
]

function ranges(source: string, rule: string): [number, number][] {
  return lint(source).filter((finding) => finding.code === rule)
    .map((finding) => [finding.range!.startOffset, finding.range!.endOffset])
}

describe('carve#6333 lint rows', () => {
  for (const [rule, source, expected] of cases) {
    it(`${rule}: ${JSON.stringify(source)}`, () => {
      expect(ranges(source, rule)).toEqual(expected)
    })
  }
})
