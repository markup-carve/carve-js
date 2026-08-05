import { describe, it, expect } from 'vitest'
import { carveToHtml } from '../src/index.js'

/**
 * A link reference definition at column 0 under a list item ends the item and
 * registers, like every other definition at a block position.
 *
 * The prepass keeps a stack of open list content columns and popped it only
 * after a blank line or a line that starts a visible block. A definition is
 * neither, so the stack still held the item's content column: the definition at
 * column 0 read as BELOW that column and was skipped, while the block lexer
 * ended the list at it anyway. The line was rendered nowhere AND defined
 * nothing (carve-js#657).
 *
 * That is the one outcome a definition may never have. It has to be exactly one
 * of "invisible and active" or "visible and inert" - the invariant carve-php#767
 * wrote down, which this engine broke from the other side.
 *
 * The executable spec, carve-rs and carve-php all collect it.
 */

const squash = (html: string) => html.replace(/\s+/g, ' ').replace(/> </g, '><').trim()

describe('a link reference definition at column 0 under a list item', () => {
  it('ends the item and resolves the reference', () => {
    expect(squash(carveToHtml('- a\n[r]: /u\n\nsee [t][r]\n'))).toBe(
      '<ul><li>a</li></ul><p>see <a href="/u">t</a></p>',
    )
  })

  it('leaves nothing of the definition line on the page', () => {
    const out = carveToHtml('- a\n[r]: /u\n\nsee [t][r]\n')
    expect(out).not.toContain('[r]: /u')
  })

  it('still collects one written AT the item content column', () => {
    // The `> indent` pop only removes columns DEEPER than the line, so a
    // definition at the column it belongs to keeps its item open. This shape
    // already worked and must keep working.
    expect(squash(carveToHtml('- a\n  [r]: /u\n\nsee [t][r]\n'))).toBe(
      '<ul><li>a</li></ul><p>see <a href="/u">t</a></p>',
    )
  })

  it('still collects one at the OUTER content column of a compact item', () => {
    expect(squash(carveToHtml('- - a\n  [r]: /u\n\nsee [t][r]\n'))).toBe(
      '<ul><li><ul><li>a</li></ul></li></ul><p>see <a href="/u">t</a></p>',
    )
  })

  it('still folds one BELOW every open content column as text', () => {
    // The boundary the fix must not move, and the shape all four agree on.
    expect(squash(carveToHtml('- - a\n [r]: /u\n\nsee [t][r]\n'))).toBe(
      '<ul><li><ul><li>a [r]: /u</li></ul></li></ul><p>see [t][r]</p>',
    )
  })
})

describe('the neighbouring definition kinds are unchanged', () => {
  it('a footnote definition at column 0 was already collected', () => {
    // Its own prepass reads the line independently of the column stack.
    const out = carveToHtml('- a\n[^f]: y\n\nsee[^f]\n')
    expect(out).toContain('doc-endnotes')
    expect(out).not.toContain('[^f]: y')
  })

  it('an abbreviation definition at column 0 still folds as item text', () => {
    // Deliberately excluded: PART 12 §7 recognizes an abbreviation definition
    // only as a direct child of the document, and all four implementations fold
    // this one as text.
    const out = carveToHtml('- x\n*[A]: b\n\nA here\n')
    expect(out).toContain('*[A]: b')
    expect(out).not.toContain('<abbr')
  })
})
