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

it('the data rules of the second batch report what the hand-written rules report on their triggers', () => {
  for (const source of ['x [^ ] y\n', '[a][ ]\n', '[ ]: u\n', 'a <b> c\n', '> a\n>\n> [x]: y\n', ' [x]: y\n', 'a\n- b\n',
    '# H {.c}\n', '%%%\n%%% x\n%%%\n', '```\ncode\n ```\n']) {
    expect(findings(source, 'data'), JSON.stringify(source)).toEqual(findings(source, 'code'))
  }
})

it('C2-B-011: indented-code-block skips a paragraph whose previous block is a list', () => {
  expect(findings('\t1. w.\n\n    :\n', 'data')).toEqual([])
})

it('C2-B-109: fence-closer-indented reports no unclosed fence and reads the source column in a quote', () => {
  expect(findings('````\n  ```\n', 'data')).toEqual([])
  expect(findings('> ```\n>   ```\n', 'data')).toEqual(['fence-closer-indented@10-13'])
})

it('C2-B-110: comment-fence-closer-with-text reads a quoted line behind its quote mark only', () => {
  expect(findings('> %%%%\n> %%%% x\n', 'data')).toEqual(['comment-fence-closer-with-text@7-15'])
  expect(findings('>   %%%%\n> >   %%%% x\n', 'data')).toEqual([])
})

it('C2-B-069: description-term-multi-line starts behind the prefixes of the line', () => {
  expect(findings('> :: w\n> w\n', 'data')).toEqual(['description-term-multi-line@9-10'])
})

it('bare-html-tag reads paragraph, heading and table row lines, not term lines', () => {
  expect(findings(':: a <b>\n', 'data')).toEqual([])
  expect(findings('| <i> |\n', 'data')).toEqual(['bare-html-tag@2-5'])
})

it('carve#6192: block-opener-overindented reports the whole opening mark', () => {
  expect(findings('# H\n\n   ::::\n   x\n   ::::\n', 'data')).toEqual(['block-opener-overindented@8-12'])
  expect(findings('  ### H\n', 'data')).toEqual(['block-opener-overindented@2-5'])
})

it('carve#6194: a colon run inside a quote or item is not compared with a div outside it', () => {
  expect(findings('::::\n> :::\n', 'data')).toEqual([])
  expect(findings('::::\n- a\n\n  :::  \n', 'data')).toEqual([])
  expect(findings('> ::::\n> :::\n', 'data')).toEqual(['colon-fence-length-mismatch@9-12'])
})

it('C2-B-161: frontmatter-shaped-thematic-break reads an opener with trailing spaces', () => {
  expect(findings('---  \n\n', 'data')).toEqual(['frontmatter-shaped-thematic-break@0-6'])
})

it('carve#6194: a div inside a footnote is not compared with a run that the document owns', () => {
  expect(findings('[^n]: :::: warning\n      ---\n:::\n', 'data').filter((f) => f.startsWith('colon'))).toEqual([])
})

it('C2-B-090: a colon container with an attached attribute line is an open colon container', () => {
  expect(findings('{.c}\n::: note\n::::\n', 'data')).toEqual(findings('{.c}\n::: note\n::::\n', 'code'))
})
