import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/*
 * PART 11 §1: `to_html(fmt(x)) == to_html(x)` and `fmt(fmt(x)) == fmt(x)`.
 *
 * An indented `--- ` inside a paragraph is an em dash, not a thematic break.
 * `guardThematicBreakLines` already protects it by re-indenting the line one
 * space - but the document-level `trimNonNbsp` then stripped that space back
 * off when the paragraph was the document's FIRST block, so the marker reached
 * column 0 and the next parse read it as `<hr>` (carve-js#566).
 *
 * The guard cannot simply move to the whole document: a REAL thematic break is
 * emitted as `---` at column 0 and must stay there.
 *
 * carve-rs and carve-php keep the space and satisfy both invariants.
 */
describe('an indented thematic marker in a paragraph', () => {
  const cases = [
    ['first block, with trailing space', '   --- \n'],
    ['first block, no trailing space', '   ---\n'],
    ['first block, followed by more text', '   --- \nx\n'],
    ['the reported repro', '   --- \n `c` $m$ # head\n'],
    ['not the first block', 'a\n\n   --- \n'],
  ] as const

  for (const [name, src] of cases) {
    it(`keeps its meaning through fmt: ${name}`, () => {
      const once = carveToCarve(src)

      expect(carveToHtml(once)).toBe(carveToHtml(src))
      expect(carveToCarve(once)).toBe(once)
      expect(carveToHtml(once)).not.toContain('<hr')
    })
  }

  it('still emits a real thematic break at column 0', () => {
    // The guard must not spread to actual thematic breaks.
    expect(carveToCarve('---\n')).toBe('---\n')
    expect(carveToHtml(carveToCarve('---\n'))).toContain('<hr')
    expect(carveToCarve('a\n\n---\n\nb\n')).toBe('a\n\n---\n\nb\n')
  })
})
