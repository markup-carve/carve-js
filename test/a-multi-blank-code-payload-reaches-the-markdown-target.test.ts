import { describe, expect, it } from 'vitest'
import { carveToMarkdown, markdownToCarve } from '../src/index.js'
import { expectBuiltInputScansLinearly, perfIt } from './helpers/scaling.js'

/*
 * Every blank line between a fence's delimiters is payload (PART 9 section 28),
 * and the Markdown target wrote ONE of them however many were authored, so a
 * two-blank payload came back as a one-blank one and the rest was gone
 * (carve-php#2736). The loss was in `normalize`, whose blank-run collapse sweeps
 * the finished document, where a payload line is indistinguishable from a gap
 * between blocks.
 *
 * Asserted directly because no corpus row can see it: the corpus comparison
 * trims both sides, and every byte here is a blank line. The readings were taken
 * against cmark-gfm 0.29.0.gfm.13 (`gfm-wasm`, the converter corpus's meaning
 * oracle at markup-carve/carve `8daf7cf7`) and reproduced through the importer,
 * which follows the same reader.
 */

const fence = (payload: string): string => `\`\`\`\n${payload}\`\`\`\n`

describe('an all-blank payload keeps every line it was authored with', () => {
  it.each([0, 1, 2, 3, 4])('writes %i blank line(s) back as itself', (count) => {
    expect(carveToMarkdown(fence('\n'.repeat(count)))).toBe(fence('\n'.repeat(count)))
  })
})

describe('a blank run inside a payload with content', () => {
  it.each([
    ['between two lines', 'x\n\n\ny\n'],
    ['before the content', '\n\nx\n'],
    ['after the content', 'x\n\n\n'],
    ['a longer run', 'x\n\n\n\n\ny\n'],
  ])('keeps the run %s', (_name, payload) => {
    expect(carveToMarkdown(fence(payload))).toBe(fence(payload))
  })

  it('keeps it behind a language token', () => {
    expect(carveToMarkdown('``` js\na\n\n\nb\n```\n')).toBe('```js\na\n\n\nb\n```\n')
  })
})

describe('inside a container the marker still reaches the line', () => {
  it('writes a quoted payload line as a bare marker, as it did before', () => {
    expect(carveToMarkdown('> ```\n> \n> \n> ```\n')).toBe('> ```\n>\n>\n> ```\n')
  })

  it('writes an item payload line with no pad, so nothing trails', () => {
    expect(carveToMarkdown('- ```\n  \n  \n  ```\n')).toBe('- ```\n\n\n  ```\n')
  })

  it('keeps an item payload that has content around the run', () => {
    expect(carveToMarkdown('- ```\n  x\n\n\n  y\n  ```\n')).toBe('- ```\n  x\n\n\n  y\n  ```\n')
  })
})

describe('the written document re-reads as the payload it was', () => {
  it.each(['\n\n', '\n\n\n', 'x\n\n\ny\n', '\n\nx\n', 'x\n\n\n'])('%j survives the round trip', (payload) => {
    expect(markdownToCarve(carveToMarkdown(fence(payload)))).toBe(fence(payload))
  })
})

describe('a held line costs nothing to take back', () => {
  // The carrier has to come off again, and `/[ \t]*<carrier>/` retried its
  // whitespace run at every position of every OTHER space run in the document:
  // one payload holding a blank line and 160000 spaces took 21 seconds where the
  // same document without the blank takes milliseconds. Raised by codex review.
  perfIt('renders a payload with a blank line and a long space run in linear time', () => {
    expectBuiltInputScansLinearly(
      (input) => void carveToMarkdown(input),
      (spaces) => `\`\`\`\nx${' '.repeat(spaces)}y\n\n\n\`\`\`\n`,
      { label: 'a blank payload line beside a long space run' },
    )
  })
})

describe('the gap between blocks is still collapsed', () => {
  it('leaves one blank line where the writer stacked more', () => {
    expect(carveToMarkdown('| a | b |\n| --- | --- |\n+ cont |\n')).toBe(
      '| a | b |\n| --- | --- |\n\n\\+ cont |\n',
    )
  })
})
