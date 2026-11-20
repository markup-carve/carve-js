import { describe, expect, it } from 'vitest'
import { pairedMarks } from '../src/pair-marks.ts'
import { lint } from '../lint/lint.ts'

describe('C2-I-050 joined bare marks', () => {
  it('skips joined openers and closers for all three legacy marks', () => {
    for (const [mark, id] of [['_', 'deprecated-bare-underline'], ['~', 'deprecated-bare-strike'], ['=', 'deprecated-bare-highlight']] as const) {
      for (const join of ['\u0301', '\ufe0f', '\u200d']) {
        const ranges: [number, number][] = []
        pairedMarks(`${mark}a${mark}${join}b${mark}`, mark, id, (start, end) => ranges.push([start, end]))
        expect(ranges).toEqual([[0, `${mark}a${mark}${join}b${mark}`.length]])
        const opener: [number, number][] = []
        pairedMarks(`${mark}${join}a${mark}`, mark, id, (start, end) => opener.push([start, end]))
        expect(opener).toEqual([])
      }
    }
  })
  it('reports the complete corpus-row pair', () => {
    const found = lint('~a~\u200db~\n').find((entry) => entry.code === 'deprecated-bare-strike')
    expect(found?.range).toBeDefined()
  })
  it('keeps a later pair when an earlier candidate cannot open', () => {
    for (const [source, start] of [['\\~foo ~bar~', 6], ['a~x ~bar~', 4], ['~ x ~bar~', 4]] as const) {
      const ranges: [number, number][] = []
      pairedMarks(source, '~', 'deprecated-bare-strike', (from, to) => ranges.push([from, to]))
      expect(ranges).toEqual([[start, source.length]])
    }
  })
})
