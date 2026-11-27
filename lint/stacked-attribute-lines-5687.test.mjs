import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const CODE = 'block-opener-without-blank-line'
const reported = (source) => lint(source).filter((entry) => entry.code === CODE)
  .map((entry) => source.slice(entry.range.startOffset, entry.range.endOffset))

// C2-B-102: stacked attribute lines are one attribute block; only one after the paragraph's text is a lazy line.
describe('carve-js#5687 stacked attribute lines above a paragraph', () => {
  for (const source of [
    '{.a}\n{.b}\nplain\n',
    '{.a}\n{.b}\n{#c}\nplain\n',
    '{.a}\n%% note\n{.b}\nplain\n',
    '> {.a}\n> {.b}\n> plain\n',
    '- {.a}\n  {.b}\n  plain\n',
    '- x\n\n  {.a}\n  {.b}\n  plain\n',
  ]) {
    it(`does not report ${JSON.stringify(source)}`, () => expect(reported(source)).toEqual([]))
  }

  for (const [source, expected] of [
    ['plain\n{.a}\nmore\n', ['{.a}']],
    ['{.a}\ntext\n{.b}\nmore\n', ['{.b}']],
    ['plain\n{.a}\n{.b}\n', ['{.a}', '{.b}']],
  ]) {
    it(`reports ${JSON.stringify(source)}`, () => expect(reported(source)).toEqual(expected))
  }
})
