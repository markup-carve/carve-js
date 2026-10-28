import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/lint.js'

const findings = (source: string, rule: string): [number, number][] =>
  lintCarve(source).filter(w => w.rule === rule).map(w => [w.line, w.column])

describe('a link destination or title is not emphasis prose', () => {
  it.each([
    ["[a](/u 't\nu')\n"],
    ['[a](/u "t\\"\nu")\n'],
    ['[a](/u "t\nu")\n'],
    ["> - [a](/u 't\n>   u')\n"],
    ["![a](/u 't\nu') b\n"],
    ['[](/u "t\nu")\n'],
  ])('quiet when the title crosses a soft wrap: %j', source => {
    expect(findings(source, 'unclosed-inline-emphasis')).toEqual([])
  })

  it('still reports an opener in the label or after the link', () => {
    expect(findings('[x /y](/u "t\nu")\n', 'unclosed-inline-emphasis')).toEqual([[1, 4]])
    expect(findings('[x](/u "t\nu") /y\n', 'unclosed-inline-emphasis')).toEqual([[2, 5]])
    expect(findings('*a [x](/u "t\nu") b\n', 'unclosed-inline-emphasis')).toEqual([[1, 1]])
  })

  it('keeps the readings the other engines are asked to adopt', () => {
    expect(findings('*a ` b*\n', 'unclosed-inline-emphasis')).toEqual([[1, 1]])
    expect(findings('a ![t[z]](/i.png) b\n', 'unclosed-inline-emphasis')).toEqual([])
    expect(findings('![a](/i){ }\n', 'unclosed-inline-emphasis')).toEqual([])
    expect(findings('<vbscript:msgbox>\n', 'bare-html-tag')).toEqual([])
    expect(findings('- a\n  [r]: /u\n more\ntail\n', 'unused-link-reference-definition')).toEqual([[2, 3]])
  })
})

it('reports a hosted footnote heading once, as a duplicate id only', () => {
  const source = '- a\n  [^n]: +\n  # h\n    # h\n\nsee[^n]\n'
  const warnings = lintCarve(source).map(w => [w.rule, w.line, w.column])
  expect(warnings.filter(([rule]) => rule === 'duplicate-heading-id')).toEqual([['duplicate-heading-id', 4, 5]])
  expect(warnings.filter(([rule]) => rule === 'list-item-block-overindented')).toEqual([])
})
