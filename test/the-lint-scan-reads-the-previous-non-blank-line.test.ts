import { describe, expect, it } from 'vitest'
import { lintCarve } from '../src/index.js'

const duplicates = (source: string): string[] =>
  lintCarve(source)
    .filter((d) => d.rule === 'duplicate-footnote-definition')
    .map((d) => `${d.line}:${d.column}`)

/**
 * carve-js#1589 moved the PARSER's marker-stripping gate to the previous
 * non-blank line. The lint scan kept the old one, so after a blank the `: `
 * description marker went unstripped, FOOTNOTE_DEF did not match, and every
 * rule below that match went blind to a definition the parser collects and
 * then drops as a duplicate. The author was told about one of two identical
 * documents (carve-js#1592).
 */
describe('the lint scan reads the previous non-blank line', () => {
  it('reports the duplicate when a blank separates the entries', () => {
    expect(duplicates('[^a]: one\n\n:: term\n:  d\n\n:  [^a]: two\n\nsee [^a]\n')).toEqual(['6:4'])
  })

  it('still reports it when they are adjacent', () => {
    expect(duplicates('[^a]: one\n\n:: term\n:  [^a]: two\n\nsee [^a]\n')).toEqual(['4:4'])
  })

  /**
   * The blank is transparent only while the list is open. With no term above
   * it the `: ` line is paragraph text, the parser registers nothing from it,
   * and the scan must agree rather than invent a duplicate.
   */
  it('stays silent when no definition list is open above it', () => {
    expect(duplicates('[^a]: one\n\npara\n\n:  [^a]: two\n\nsee [^a]\n')).toEqual([])
  })
})
