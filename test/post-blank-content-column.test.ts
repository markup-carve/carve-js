import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/*
 * Post-blank list continuation: the content-column model (carve#295).
 *
 * A block after a blank line belongs to a list item iff it reaches the item's
 * content column (marker width: `- ` -> 2, `1. ` -> 3). Below the content
 * column the list ends and the block parses at document level. At the content
 * column a block opener attaches. Above it, the residual leading space means
 * the line is no longer a block opener - exactly as ` # h` is a paragraph, not
 * a heading, at the top level - so it folds in as a second paragraph.
 *
 * This is the SAME rule the no-blank case uses; the blank line only decides
 * tight vs loose. It is an intentional divergence from djot (which attaches at
 * any indent past the marker). The `+` marker still attaches a flush-left
 * block regardless.
 */
const h = (s: string) => carveToHtml(s).trim()

describe('post-blank continuation: bullet (content column 2)', () => {
  it('BELOW the content column (1 space) detaches, and the leading space keeps it a paragraph', () => {
    // The detached `> q` retains its one leading space, so - consistent with
    // the column-0 rule - it is a paragraph, not a blockquote, exactly as ` > q`
    // is at the top level.
    expect(h('- one\n\n > q')).toBe(
      '<ul>\n  <li>one</li>\n</ul>\n<p>&gt; q</p>',
    )
  })

  it('a below-column heading detaches, and keeps its own leading space (still not a heading)', () => {
    expect(h('- one\n\n # h')).toBe('<ul>\n  <li>one</li>\n</ul>\n<p># h</p>')
  })

  it('AT the content column (2 spaces) attaches as a block and stays tight', () => {
    expect(h('- one\n\n  > q')).toBe(
      '<ul>\n  <li>one\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>',
    )
  })

  it('ABOVE the content column (3 spaces) is lazy paragraph text, and loosens the item', () => {
    expect(h('- one\n\n   > q')).toBe(
      '<ul>\n  <li><p>one</p>\n    <p>&gt; q</p>\n  </li>\n</ul>',
    )
  })
})

describe('post-blank continuation: ordered (content column 3)', () => {
  it('BELOW the content column (2 spaces) detaches', () => {
    expect(h('1. one\n\n  > q')).toBe(
      '<ol>\n  <li>one</li>\n</ol>\n<p>&gt; q</p>',
    )
  })

  it('AT the content column (3 spaces) attaches and stays tight', () => {
    expect(h('1. one\n\n   > q')).toBe(
      '<ol>\n  <li>one\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ol>',
    )
  })

  it('ABOVE the content column (4 spaces) is lazy paragraph text', () => {
    expect(h('1. one\n\n    > q')).toBe(
      '<ol>\n  <li><p>one</p>\n    <p>&gt; q</p>\n  </li>\n</ol>',
    )
  })
})

describe('post-blank continuation: the + marker is unaffected', () => {
  it('a flush-left block after a lone + still attaches', () => {
    expect(h('- one\n\n+\n> q')).toBe(
      '<ul>\n  <li>one\n    <blockquote><p>q</p></blockquote>\n  </li>\n</ul>',
    )
  })
})
