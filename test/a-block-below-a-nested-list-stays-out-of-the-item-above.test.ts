import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

/**
 * A nested list is the one block this target writes with no blank line behind
 * it, so the seam under it was never a decision the tight-item predicate could
 * reach: that decides whether to TAKE a blank away, and here there was none to
 * take. cmark-gfm 0.29.0.gfm.13 then reads the block below as lazy continuation
 * of the last nested item - a table's rows do not reach the output at all, and a
 * paragraph lands inside that item instead of beside it (carve-js#2085).
 *
 * Only a block whose Markdown spelling opens with plain text can be taken that
 * way, and only where the tail can take lazy text, so the controls below stay
 * glued and their items stay tight.
 */

/** What the emitted Markdown holds once a Markdown reader has had it back. */
const reread = (source: string): string => carveToHtml(markdownToCarve(carveToMarkdown(source)))

describe('a block below a nested list keeps its blank line', () => {
  it('separates a paragraph from the item above it', () => {
    expect(carveToMarkdown('- - A\n\n  second\n')).toBe('- - A\n\n  second\n')
    expect(reread('- - A\n\n  second\n')).toContain('<p>second</p>')
  })

  it('separates a table, whose rows are otherwise lost', () => {
    expect(carveToMarkdown('- x\n  - L\n+\n| a |\n|---|\n')).toBe('- x\n  - L\n\n  | a |\n  | --- |\n')
    expect(reread('- x\n  - L\n+\n| a |\n|---|\n')).toContain('<table')
  })

  it('separates a definition list', () => {
    expect(carveToMarkdown('- - A\n\n  term\n  : def\n')).toBe('- - A\n\n  term\n  : def\n')
  })

  it('separates a paragraph below a deeper sublist', () => {
    expect(carveToMarkdown('- - - A\n\n  second\n')).toBe('- - - A\n\n  second\n')
    expect(carveToMarkdown('- 1. A\n\n  second\n')).toBe('- 1. A\n\n  second\n')
  })

  it('leaves the openers that interrupt on their own glued', () => {
    // The controls. A heading, a fence, a quote and a thematic break open a
    // block against a paragraph line, so no blank is written and the outer item
    // does not go loose.
    expect(carveToMarkdown('- x\n  - L\n+\n# h\n')).toBe('- x\n  - L\n  # h\n')
    expect(carveToMarkdown('- x\n  - L\n+\n``` r\nc\n```\n')).toBe('- x\n  - L\n  ```r\n  c\n  ```\n')
    expect(carveToMarkdown('- x\n  - L\n+\n> q\n')).toBe('- x\n  - L\n  > q\n')
    expect(carveToMarkdown('- x\n  - L\n+\n---\n')).toBe('- x\n  - L\n  ---\n')
  })

  it('leaves a tail that cannot take lazy text glued', () => {
    // A heading inside the nested item ended its paragraph, so the line below is
    // not lazy continuation of anything and the item stays tight.
    expect(carveToMarkdown('- a\n  - b\n    # N\nlazy\n')).toBe('- a\n  - b\n    # N\n  lazy\n')
    // A thematic break closes what is above it rather than continuing it.
    expect(carveToMarkdown('- - A\n\n    ---\n  second\n')).toBe('- - A\n\n    ---\n  second\n')
  })

  it('leaves the tight-item separator rule where it was', () => {
    // Two sibling quotes keep their separator and read back as two quotes; a
    // quote under a paragraph still drops it and reads tight (carve-js#2056).
    expect(carveToMarkdown('- x\n  > q\n+\n  > r\n')).toBe('- x\n  > q\n\n  > r\n')
    expect(carveToMarkdown('- x\n  > q\n')).toBe('- x\n  > q\n')
  })
})
