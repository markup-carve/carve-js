import { describe, expect, it } from 'vitest'
import { carveToHtml, markdownToCarve } from '../src/index.js'

/**
 * Indented code cannot interrupt a paragraph, and that holds for the paragraph
 * of a quote a list item opens on its MARKER line.
 *
 * #1942 taught the list collector to hand a quote opening with indented code to
 * `quotedIndentedCodeAt`, which is right after a blank quote line and wrong
 * here: the line above `  >     code` is `- > alpha`, and once the item's
 * columns come off it carries no `>` of its own, so the helper reports that the
 * code opens the quote. The line was written as a fence and a paragraph turned
 * into a code block (markup-carve/carve-js#1941).
 *
 * The `cmark-gfm reads` notes are cmark-gfm 0.29.0.gfm.13 through the
 * `cmarkgfm` binding, not this engine.
 */
describe('indented code under an item’s quote paragraph stays in the paragraph', () => {
  it('keeps a bullet item’s quote paragraph whole', () => {
    // cmark-gfm reads:
    // <ul>\n<li>\n<blockquote>\n<p>alpha\ncode</p>\n</blockquote>\n</li>\n</ul>
    const out = markdownToCarve('- > alpha\n  >     code\n')
    expect(out).not.toContain('```')
    expect(carveToHtml(out)).toBe(
      '<ul>\n  <li>\n    <blockquote><p>alpha\ncode</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('keeps an ordered item’s quote paragraph whole', () => {
    const out = markdownToCarve('1. > alpha\n   >     code\n')
    expect(out).not.toContain('```')
    expect(carveToHtml(out)).toContain('<p>alpha\ncode</p>')
  })

  it('keeps it whole at any depth past the quote’s content', () => {
    const out = markdownToCarve('- > alpha\n  >       code\n')
    expect(out).not.toContain('```')
    expect(carveToHtml(out)).toContain('<p>alpha\ncode</p>')
  })

  it('still writes a fence where the quote has no paragraph open', () => {
    // cmark-gfm reads a <pre><code> in the quote: the blank quote line closed
    // the paragraph, so the indented line opens a block of its own.
    expect(markdownToCarve('- > alpha\n  >\n  >     code\n')).toBe(
      '- > alpha\n  >\n  > ```\n  > code\n  > ```\n',
    )
    expect(markdownToCarve('1. > alpha\n   >\n   >     code\n')).toBe(
      '1. > alpha\n   >\n   > ```\n   > code\n   > ```\n',
    )
  })

  it('leaves a quote that opens on its own line alone either way', () => {
    expect(markdownToCarve('- item\n  > quote\n  >     code\n')).not.toContain('```')
    expect(markdownToCarve('- item\n  > quote\n  >\n  >     code\n')).toBe(
      '- item\n  > quote\n  >\n  > ```\n  > code\n  > ```\n',
    )
  })
})
