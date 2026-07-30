import { describe, expect, it } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * In CommonMark a change of ordered-list delimiter SEPARATES two adjacent lists,
 * exactly as a change of bullet does. Measured against commonmark.js: `1. a`
 * followed by `1) c` gives two `<ol>` elements; the same input with one delimiter
 * gives one.
 *
 * So normalizing `1)` to `1.` merges lists the source kept apart - the same defect
 * the bullet marker had (carve#352, corpus 31). The AST records `delim` and
 * `renderCarve` already reproduces it; only this target dropped it.
 */
describe('the Markdown renderer keeps the authored ordered delimiter', () => {
  it('keeps a paren delimiter', () => {
    expect(carveToMarkdown('1) one\n2) two\n')).toBe('1) one\n2) two\n')
  })

  it('keeps a dot delimiter', () => {
    expect(carveToMarkdown('1. one\n2. two\n')).toBe('1. one\n2. two\n')
  })

  it('keeps two adjacent lists apart', () => {
    const out = carveToMarkdown('1. a\n2. b\n\n1) c\n2) d\n')
    expect(out).toContain('1. a')
    expect(out).toContain('1) c')
  })

  it('respects an explicit start value with either delimiter', () => {
    expect(carveToMarkdown('3) three\n4) four\n')).toBe('3) three\n4) four\n')
  })
})
