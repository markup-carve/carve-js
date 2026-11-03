import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

// A list item owner reports under list-item-block-overindented, so one line
// never carries both overindent findings (PART 0 S3 lint clause).
const rulesByLine = (source: string): Map<number, string[]> => {
  const lines = new Map<number, string[]>()
  for (const w of lintCarve(source)) {
    if (w.rule.endsWith('overindented')) lines.set(w.line, [...(lines.get(w.line) ?? []), w.rule])
  }
  return lines
}

describe('one line never carries both overindent findings', () => {
  it.each([
    ['a fence in a box in a quoted item', '> - ::: box\n>   - ::: |\n>     ```\n>     :::\n>    ```\n>    :::bad\n>    :::\n- tail\n', 5],
    ['a heading in a box in an item', '- ::: box\n   # h\n  :::\n', 2],
    ['a quote in a box in an ordered item', '1. ::: box\n    > q\n   :::\n', 2],
  ])('%s', (_name, source, line) => {
    expect(rulesByLine(source).get(line)).toEqual(['list-item-block-overindented'])
  })

  it('keeps block-opener-overindented where no list item owns the line', () => {
    expect(rulesByLine('::: box\n # h\n:::\n').get(2)).toEqual(['block-opener-overindented'])
  })
})
