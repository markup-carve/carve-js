import { afterEach, expect, it } from 'vitest'
import { lint } from './lint.ts'
import { DATA_RULE_IDS } from './data-rules.ts'

function findings(source, mode) {
  if (mode === 'data') process.env.CARVE_LINT_RULES = 'data'
  else delete process.env.CARVE_LINT_RULES
  return lint(source).filter((entry) => DATA_RULE_IDS.has(entry.code))
    .map((entry) => `${entry.code}@${entry.range.startOffset}-${entry.range.endOffset}`)
}

afterEach(() => { delete process.env.CARVE_LINT_RULES })

const SAME = [
  'a\n\n---\n', '- - -\n', 'a. - - -\n', '>a\n', '---\n>a\n---\n', 'a\n# b\n', 'a\n> b\n', 'a\n:: t\n',
  'a\n{.c}\n', 'a\n[x]: /u\n', '{.c}\n\nb\n', '| a |\n\nTable: cap\n', '::: a\n:::: b\nx\n:::\n',
  '> # a\n', '- a\n\n    # b\n', '1. a\n\n  b\n', '  # a\n', '::: note\na\n::::\n',
]

it('the data rules report what the hand-written rules report on their triggers', () => {
  for (const source of SAME) expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
})

it('C2-B-108 and the ruling of carve#6175: a directive is an open colon container', () => {
  expect(findings(':::: references\n:::\n', 'data')).toEqual(['colon-fence-length-mismatch@16-19'])
  expect(findings('::::\n::: glossary\n:::\n::::\n', 'data')).toEqual([])
})

it('C2-B-090: an attribute line with a space after its brace is an attribute line', () => {
  expect(findings('{ #id }\n', 'data')).toEqual(['unattached-block-attribute@0-7'])
  expect(findings('a\n{ #id }\n', 'data')).toEqual(['block-opener-without-blank-line@2-9'])
})

it('C2-B-031: a quote mark followed by a tab is text', () => {
  expect(findings('>\t\n', 'data')).toEqual(['blockquote-marker-without-space@0-1'])
})

it('C2-B-146: a lone pipe is no table row next to a caption-looking line', () => {
  expect(findings('Table: x\n|\n', 'data')).toEqual([])
})
