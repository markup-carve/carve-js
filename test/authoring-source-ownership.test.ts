import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const findings = (source: string, rule: string) => lintCarve(source)
  .filter(warning => warning.rule === rule)
  .map(({ line, column }) => [line, column])

describe('authoring findings follow parsed source ownership', () => {
  it('reports a definition-shaped paragraph after a tab marker', () => {
    expect(findings('::\tterm\n:  d\n', 'markdown-definition-paragraph')).toEqual([[2, 1]])
    expect(findings(':: term\n:  d\n', 'markdown-definition-paragraph')).toEqual([])
  })

  it('reports a marker folded into a nested container paragraph', () => {
    const source = '- head\n\n      ::: note\n      a\n      - second\n'
    expect(findings(source, 'list-marker-without-blank-line')).toEqual([[5, 7]])
  })

  it('does not inspect HTML tags inside an inline code span', () => {
    const source = '- a\n  > q\n   ```=html\n   <b>r</b>\n   ```\n'
    expect(findings(source, 'bare-html-tag')).toEqual([])
    expect(findings('<b>r</b>\n', 'bare-html-tag')).toEqual([[1, 1]])
  })

  it('does not call paired delimiters after atomic references unclosed', () => {
    for (const prefix of ['<https://a[>', '</#a[>']) {
      expect(findings(`${prefix} *q](u*) z\n`, 'unclosed-inline-emphasis')).toEqual([])
    }
    expect(findings('*open\n', 'unclosed-inline-emphasis')).toEqual([[1, 1]])
  })
})
