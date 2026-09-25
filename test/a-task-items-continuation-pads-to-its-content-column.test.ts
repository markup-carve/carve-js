import { describe, expect, it } from 'vitest'
import { carveToHtml, carveToMarkdown, markdownToCarve } from '../src/index.js'

/**
 * A task item's `[x] ` is the first inline of its first paragraph, not part of
 * the marker, so a reader's content column for the item is the bullet's width
 * alone. Padding a continuation by the whole printed prefix put every block
 * below four columns past that, where cmark-gfm 0.29.0.gfm.13 answers with
 * indented code above a blank line and with paragraph text without one - the
 * authored block reached the output in neither spelling (carve-js#2085).
 *
 * Each expectation reads its own output back with `markdownToCarve`, which
 * follows that reader. The bytes are asserted beside it because the pad is the
 * thing that moved.
 */

/** What the emitted Markdown holds once a Markdown reader has had it back. */
const reread = (source: string): string => carveToHtml(markdownToCarve(carveToMarkdown(source)))

describe('a task item pads its continuation to its content column', () => {
  it('puts a heading below the item at the bullet, not at the checkbox', () => {
    expect(carveToMarkdown('-   [ ] item\n    # H\n')).toBe('- [ ] item\n  # H\n')
    expect(reread('-   [ ] item\n    # H\n')).toContain('<h1')
  })

  it('pads a checked item the same', () => {
    expect(carveToMarkdown('- [x] item\n  # H\n')).toBe('- [x] item\n  # H\n')
    expect(reread('- [x] item\n  # H\n')).toContain('<h1')
  })

  it('measures the pad from the authored bullet', () => {
    expect(carveToMarkdown('* [ ] item\n  # H\n')).toBe('* [ ] item\n  # H\n')
    expect(reread('* [ ] item\n  # H\n')).toContain('<h1')
  })

  it('carries a fence, a table and a sublist below a task item', () => {
    expect(carveToMarkdown('- [ ] item\n  ```\n  code\n  ```\n')).toBe('- [ ] item\n  ```\n  code\n  ```\n')
    expect(reread('- [ ] item\n  ```\n  code\n  ```\n')).toContain('<pre>')
    expect(carveToMarkdown('- [ ] item\n  - sub\n')).toBe('- [ ] item\n  - sub\n')
    expect(reread('- [ ] item\n  | a |\n  |---|\n')).toContain('<table')
  })

  it('leaves the pad on every item that has no checkbox', () => {
    // The controls. Here the whole printed prefix IS the marker, so the pad is
    // the prefix and none of these moves.
    expect(carveToMarkdown('- item\n  # H\n')).toBe('- item\n  # H\n')
    expect(carveToMarkdown('1. item\n   # H\n')).toBe('1. item\n   # H\n')
    expect(carveToMarkdown('10. item\n    # H\n')).toBe('10. item\n    # H\n')
    expect(carveToMarkdown('1) item\n   # H\n')).toBe('1) item\n   # H\n')
  })
})
