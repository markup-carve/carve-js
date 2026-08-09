import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * PART 11 §10b: where a delimiter row is required to promote the first row to a
 * header, that delimiter carries exactly one cell for each cell in the HEADER
 * ROW, not one for each column reached by a wider body row.
 *
 * This renderer sized the delimiter from the TABLE width, so a ragged table
 * emitted `| h |` over `| --- | --- |`. Neither python-markdown nor marked reads
 * that as a table - the cell counts have to agree - so the document published as
 * a paragraph of pipes and lost its table entirely (carve#1042).
 *
 * All three engines agreed on the wider row, which is why the cross-engine
 * render comparison scored it green throughout; the evidence that settles it is
 * an external reader, not another engine.
 */
const lines = (src: string): string[] => carveToMarkdown(src).split('\n')
const cellCount = (row: string): number => row.split('|').slice(1, -1).length

describe('the Markdown delimiter row is sized from the header row', () => {
  it('does not widen the delimiter to reach a wider body row', () => {
    // Corpus 284-a-ragged-table-keeps-each-row-s-cell-count-3: a one-cell header
    // over a two-cell body row.
    const out = lines('| h |\n|---|\n| |x |\n')
    expect(out[0]).toBe('| h |')
    expect(out[1]).toBe('| --- |')
    expect(out[2]).toBe('|  | x |')
  })

  it('reaches the span-free shape too', () => {
    const out = lines('|=a|\n| x | y |\n')
    expect(out[0]).toBe('| a |')
    expect(out[1]).toBe('| --- |')
    expect(out[2]).toBe('| x | y |')
  })

  it('keeps the delimiter as wide as a header that is wider than its body', () => {
    // Corpus 284-a-ragged-table-keeps-each-row-s-cell-count-2: the header is the
    // wide row here, so the delimiter stays two cells.
    const out = lines('| |x |\n|---|\n| y |\n')
    expect(out[0]).toBe('|  | x |')
    expect(out[1]).toBe('| --- | --- |')
    expect(out[2]).toBe('| y |')
  })

  it('keeps the header alignment while narrowing', () => {
    const out = lines('|=> h |\n| x | y |\n')
    expect(out[1]).toBe('| ---: |')
  })

  it('always matches the delimiter to the header it promotes', () => {
    for (const src of [
      '| h |\n|---|\n| |x |\n',
      '|=a|\n| x | y |\n',
      '| |x |\n|---|\n| y |\n',
      '|= A |= B |\n| 1 | 2 |\n',
      '|=> h |\n| x | y | z |\n',
    ]) {
      const out = lines(src)
      expect(cellCount(out[1] ?? '')).toBe(cellCount(out[0] ?? ''))
    }
  })
})
