import { expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

it('uses the parsed first footnote definition site across list nesting', () => {
  const warnings = lintCarve('- a\n  [^f]: t\n[^f]: a\n')
  expect(warnings.map(({ line, column, rule }) => ({ line, column, rule }))).toEqual([
    { line: 2, column: 3, rule: 'unused-footnote-definition' },
    { line: 3, column: 1, rule: 'duplicate-footnote-definition' },
  ])
})
