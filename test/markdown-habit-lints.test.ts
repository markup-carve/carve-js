import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

// carve#4814: the shared vectors in spec/tests/lint-rule-vectors cover the rules; these pin the edges they leave open.
const rules = new Set(['setext-heading-underline', 'heading-closing-hashes', 'indented-code-block'])
const findings = (source: string) =>
  lintCarve(source).filter(w => rules.has(w.rule)).map(w => [w.rule, w.line, w.column])

describe('Markdown habit lints', () => {
  it('stay silent on an indented line after a paragraph written flush under a list', () => {
    expect(findings('- :: t\n:  head\n\n     a\n')).toEqual([])
  })

  it('report an indented line once a blank line separates the paragraph from the list', () => {
    expect(findings('- a\n\npara\n\n    code\n')).toEqual([['indented-code-block', 5, 5]])
  })

  it('leave a spaced break under a paragraph alone', () => {
    expect(findings('Title\n- - -\n')).toEqual([])
  })

  it('report the underline and closing run inside a list item', () => {
    expect(findings('- Title\n  ---\n')).toEqual([['setext-heading-underline', 2, 3]])
    expect(findings('- ## h ##\n')).toEqual([['heading-closing-hashes', 1, 8]])
  })

  it('read CRLF lines like LF lines', () => {
    expect(findings('Title\r\n---\r\n')).toEqual([['setext-heading-underline', 2, 1]])
    expect(findings('## h ##\r\n')).toEqual([['heading-closing-hashes', 1, 6]])
    expect(findings('para\r\n\r\n    code\r\n')).toEqual([['indented-code-block', 3, 5]])
  })

  it('report a closing run after formatted heading text', () => {
    expect(findings('## *h* ##\n')).toEqual([['heading-closing-hashes', 1, 8]])
    expect(findings('## [h](/x) ##\n')).toEqual([['heading-closing-hashes', 1, 12]])
    expect(findings('## `h` \\#\n')).toEqual([])
  })
})
