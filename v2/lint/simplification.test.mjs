// Lint rules the simplifications and rulings of 16 November 2026 added or changed.
import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const findings = (source, code) => lint(source).filter((entry) => entry.code === code)

describe('C2-B-137, C2-B-154: deprecated-indented-line-under-heading across comment-only lines', () => {
  it('C2-B-137: names the indented line below a comment-only line, Example 248', () => {
    const found = findings('= Title\n%% note\n  continues\n', 'deprecated-indented-line-under-heading')
    expect(found.map((entry) => entry.range)).toEqual([{ startOffset: 16, endOffset: 27 }])
  })

  it('C2-B-137: a heading that only takes a comment-only line has no continuation to report', () => {
    expect(findings('= Title\n%% note\ntext\n', 'deprecated-indented-line-under-heading')).toEqual([])
  })
})

describe('C2-W-137: comment-splits-table-row', () => {
  it('C2-W-137: writer Example 8, a comment-only line between a row and its continuation, as a hint on the comment', () => {
    expect(findings('| a |\n%% x\n+ b |\n', 'comment-splits-table-row').map((entry) => [entry.severity, entry.range]))
      .toEqual([['hint', { startOffset: 6, endOffset: 10 }]])
  })

  it('C2-W-137: a trailing comment of the row directly above the continuation is reported too', () => {
    expect(findings('| a | %% x\n+ b |\n', 'comment-splits-table-row').map((entry) => entry.range))
      .toEqual([{ startOffset: 6, endOffset: 10 }])
  })

  it('C2-W-137: no report between two separate rows or after the last continuation row', () => {
    expect(findings('| a |\n%% x\n| b |\n', 'comment-splits-table-row')).toEqual([])
    expect(findings('| a |\n+ b |\n%% x\n', 'comment-splits-table-row')).toEqual([])
  })
})
