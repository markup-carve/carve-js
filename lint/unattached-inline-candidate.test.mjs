import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const ranges = (source) => lint(source)
  .filter((finding) => finding.code === 'unattached-inline-attribute')
  .map((finding) => [finding.range.startOffset, finding.range.endOffset])

// carve#6350: a brace that opens no valid block does not hide a block that starts inside it.
describe('unattached-inline-attribute reads every brace candidate', () => {
  for (const [source, expected] of [
    ['x\n> > {_x {.c}\n', [[10, 14]]],
    ['a\n> {.c} {.c}\n', [[4, 8], [9, 13]]],
    ['a {.a} b {_x {.c}\n', [[2, 6], [13, 17]]],
    ['a {_x {.c}\n', [[6, 10]]],
    ['a {{.c}\n', [[3, 7]]],
    ['a {%x {.c}\n', [[6, 10]]],
    ['a {title="{.d}"}\n', [[2, 16]]],
    ['a {title="x}"}\n', [[2, 14]]],
    ['> > {_x {.c}\n', [[8, 12]]],
    ['x {k=v{k="{.d}"}\n', [[6, 16]]],
    ['x "{k="{.d}"} y\n', [[3, 13]]],
    ['# x "{.a}\n', [[5, 9]]],
    // A mention, a tag and a cross-reference are not hosts (C2-I-036).
    ['@user{.c} and #tag{.c}\n', [[5, 9], [18, 22]]],
  ]) {
    it(`reports ${JSON.stringify(expected)} in ${JSON.stringify(source)}`, () => {
      expect(ranges(source)).toEqual(expected)
    })
  }
})

// C2-I-035: a valid block is one atom, and the run that opens a paragraph line is block-marker-as-text's.
describe('unattached-inline-attribute leaves a line-opening run alone', () => {
  for (const [source, expected] of [
    ['{k="{.d}"} x\n', []],
    ['{.a}{.b} x\n', []],
    ['a\\\n{.a}{.b} y\n', []],
    ['- {.a}{.b} x\n', []],
    ['{.a} {.b} x\n', [[5, 9]]],
    ['{_x {.c} y\n', [[4, 8]]],
    ['# {k="{.d}"} x\n', []],
    ['# {.a}{.b} x\n', [[6, 10]]],
  ]) {
    it(`reports ${JSON.stringify(expected)} in ${JSON.stringify(source)}`, () => {
      expect(ranges(source)).toEqual(expected)
    })
  }
})
