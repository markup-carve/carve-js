import { describe, expect, it } from 'vitest'
import { lint } from './lint.ts'

const alignment = (source, options = { upgrade: true }) =>
  lint(source, options).filter((finding) => finding.code === 'deprecated-cell-alignment')

describe('C2-B-171, C2-B-182: old cell alignment before an empty cell', () => {
  it('reports complete cells with the old alignment run and a separating space', () => {
    for (const [source, prefix, start] of [
      ['|?v |', '?v', 1],
      ['|> |', '>', 1],
      ['|~ |', '~', 1],
      ['|>v |', '>v', 1],
      ['|=?v |', '?v', 2],
      ['|>{.c} |', '>{.c}', 1],
      ['|?v | x |', '?v', 1],
      ['|?v a |', '?v', 1],
    ]) {
      const entries = alignment(source)
      expect(entries, source).toHaveLength(1)
      expect(entries[0].range, source).toEqual({ startOffset: start, endOffset: start + prefix.length })
      expect(entries[0].message, source).toContain(`prefix "${prefix}"`)
    }
  })

  it('keeps the lone less-than cell and 0.2 spelling outside this notice', () => {
    for (const source of ['|< |', '|<|', '|{?v} |', '|?v|']) expect(alignment(source), source).toEqual([])
    expect(alignment('|?v |', { upgrade: false })).toEqual([])
  })
})
