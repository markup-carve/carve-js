import { describe, expect, it } from 'vitest'
import { lint } from '../lint/lint.ts'

const spans = (source: string, code: string) => lint(source).filter((finding) => finding.code === code)
  .map(({ range }) => [range?.startOffset, range?.endOffset])

describe('0.2 list lint rulings', () => {
  it('CC-1387: a description list is not the deeper bullet or ordered list', () => {
    expect(spans('* - %%\n      :: term\n\n    - -\n', 'list-marker-below-content-column')).toEqual([])
    expect(spans('- a\n  - b\n * c\n', 'list-marker-below-content-column')).toHaveLength(1)
  })

  it('CC-1388: an overindented opener inside a div belongs to the list item', () => {
    const source = '1. ::::\n    >\n'
    expect(spans(source, 'list-item-block-overindented')).toEqual([[12, 13]])
    expect(spans(source, 'block-opener-overindented')).toEqual([])
  })
})
