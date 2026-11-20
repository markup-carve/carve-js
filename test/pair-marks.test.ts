import { describe, expect, it } from 'vitest'
import { pairedMarks } from '../src/pair-marks.ts'
import { lint } from '../lint/lint.ts'

describe('C2-I-050 joined bare marks', () => {
  it('skips joined openers and closers for all three legacy marks', () => {
    for (const [mark, id] of [['_', 'deprecated-bare-underline'], ['~', 'deprecated-bare-strike'], ['=', 'deprecated-bare-highlight']]) {
      for (const join of ['\u0301', '\ufe0f', '\u200d']) {
        const ranges = []
        pairedMarks(`${mark}a${mark}${join}b${mark}`, mark, id, (start, end) => ranges.push([start, end]))
        expect(ranges).toEqual([[0, `${mark}a${mark}${join}b${mark}`.length]])
        const opener = []
        pairedMarks(`${mark}${join}a${mark}`, mark, id, (start, end) => opener.push([start, end]))
        expect(opener).toEqual([])
      }
    }
  })
  it('reports the complete corpus-row pair', () => {
    const found = lint('~a~\u200db~\n').find((entry) => entry.code === 'deprecated-bare-strike')
    expect(found?.range).toBeDefined()
  })
})
