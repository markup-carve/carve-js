import { expect, it } from 'vitest'
import { lint } from './lint.ts'
import { semanticSpan } from '../extensions/inline/semantic-span.ts'

const NINE = new Set(['consumed-key-near-miss', 'deprecated-table-attribute', 'semantic-attribute-outside-span',
  'semantic-attribute-value-ignored', 'table-attribute-invalid', 'table-column-arity', 'table-column-overlap',
  'table-row-count-clamped', 'table-width-total'])

function findings(source, options) {
  return lint(source, options).filter((entry) => NINE.has(entry.code))
    .map((entry) => `${entry.code}@${entry.range.startOffset}-${entry.range.endOffset}`)
}

it('C2-W-148: the attribute rows report what the hand-written rules reported on their triggers', () => {
  const cases = [
    ['{header-rows=1}\n| a |\n| b |\n', ['deprecated-table-attribute@0-27']],
    ['{tabel}\n```csv\na,b\n```\n', ['consumed-key-near-miss@8-22']],
    ['# H\n\n{kbd=x}\npara\n', ['semantic-attribute-outside-span@6-9']],
    ['{aligns=left,right}\n|={<} a |={>} b |\n| c | d |\n', ['table-column-overlap@1-7', 'table-column-overlap@1-7']],
    ['{valigns=top}\n|={<^} a |\n', ['table-column-overlap@1-8']],
    ['-{kbd} b\n', ['semantic-attribute-outside-span@2-5']],
    ['- {kbd}\n  b\n', ['semantic-attribute-outside-span@3-6']],
    ['{widths=50}\n| a | b |\n', ['table-column-arity@1-7']],
    ['{footer-rows=3}\n| a |\n| b |\n', ['table-row-count-clamped@1-14']],
    ['{aligns=x}\n| a |\n', ['table-attribute-invalid@1-9']],
    ['a [x]{abbr=t} b\n', []],
  ]
  for (const [source, expected] of cases) expect(findings(source, { upgrade: true }), JSON.stringify(source)).toEqual(expected)
})

it('C2-B-102: every attribute line of a table carries its keys', () => {
  expect(findings('{#t}\n{aligns=left}\n|={>} a |= b |\n')).toEqual(['table-column-arity@6-12', 'table-column-overlap@6-12'])
})

it('C2-B-090: an attribute line behind quote marks is read behind them', () => {
  expect(findings('> {tabel}\n> ```csv\n> a,b\n> ```\n')).toEqual(['consumed-key-near-miss@12-30'])
})

it('C2-I-039: a later key replaces an earlier one, and the rows report the part the node keeps', () => {
  expect(findings('a [x]{kbd kbd=1} b\n')).toEqual(['semantic-attribute-value-ignored@10-15'])
  expect(findings('{aligns=left aligns=x}\n| a |\n')).toEqual(['table-attribute-invalid@13-21'])
  // C2-A-035: an ordinary key merges by its lower-case name, so `Abbr` replaces `abbr` and is no semantic key (C2-H-075).
  expect(findings('`c`{abbr=a Abbr=y}\n')).toEqual([])
})

it('C2-I-036: a glued block reports its own part, not the same text in the content', () => {
  expect(findings('[a kbd=1 b]{kbd=1}\n')).toEqual(['semantic-attribute-value-ignored@12-17'])
})

it('C2-I-033: a range ends behind the closing quote of a quoted value', () => {
  expect(findings('{table header-rows="5"}\n```csv\na,b\nc,d\n```\n')).toEqual(['table-row-count-clamped@7-22'])
  expect(findings("{footer-rows='3'}\n| a |\n| b |\n")).toEqual(['table-row-count-clamped@1-16'])
})

it('C2-B-211, C2-B-212: table-width-total sums every entry, those past the last column included', () => {
  expect(findings('{widths=60,60}\n| a |\n')).toEqual(['table-width-total@1-7'])
  expect(findings('{widths=33.3,33.3,33.4}\n| a | b | c |\n')).toEqual([])
  expect(findings('{widths=33.3,33.3,33.41}\n| a | b | c |\n')).toEqual(['table-width-total@1-7'])
  // An exact total past what a number holds: just below 100 is not reported, just above is.
  expect(findings('{widths=99.9999999999999999}\n| a |\n')).toEqual([])
  expect(findings('{widths=50.00000000000000001,50}\n| a | b |\n')).toEqual(['table-width-total@1-7'])
})

it('C2-B-182: the alignment marks of a cell prefix are no part, and a key behind them is', () => {
  expect(findings('|{>abbr=x} a |\n')).toEqual(['semantic-attribute-outside-span@3-7'])
})

it('C2-H-075: a key that a registered extension adds is semantic, as the hand-written rule read it', () => {
  expect(findings('a [x]{samp=1} b\n', { extensions: semanticSpan().extensions })).toEqual(['semantic-attribute-value-ignored@6-12'])
})
