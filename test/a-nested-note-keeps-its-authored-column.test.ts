import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const owner = (html: string): string => {
  const t = html.indexOf('TAILWORD')
  if (t < 0) return 'absent'
  const fn1 = html.indexOf('id="fn1"')
  const fn2 = html.indexOf('id="fn2"')
  if (fn2 >= 0 && t > fn2) return 'inner'
  return t > fn1 ? 'outer' : 'body'
}

/**
 * PART 0's owner-selection table gives a line at or below a frame's
 * `base_column` to the nearest surviving ancestor. A nested note flattened to
 * column zero loses that geometry: the run dedents by the marker's own column,
 * but a trailing line BELOW that column cannot move with it, so it landed on
 * the note's new floor and the note claimed a line belonging to the outer note
 * (markup-carve/carve#1971). The note now keeps its authored column, which is
 * what the per-marker body column of carve-js#1664 measures against.
 */
describe('a nested note keeps its authored column', () => {
  it('gives a line at or below the nested marker to the outer note', () => {
    const html = carveToHtml(
      '[^f]: outer\n\n     [^g]: mid\n\n       [r]: /url\n    TAILWORD\n\nx[^f] [^g] [t][r]\n',
    )
    expect(owner(html)).toBe('outer')
    expect(html).toContain('href="/url"')
  })

  it('still gives a line at the nested body column to the nested note', () => {
    const html = carveToHtml(
      '[^f]: outer\n\n     [^g]: mid\n\n       [r]: /url\n       TAILWORD\n\nx[^f] [^g] [t][r]\n',
    )
    expect(owner(html)).toBe('inner')
  })

  it('leaves a line below the outer note in the document body', () => {
    const html = carveToHtml(
      '[^f]: outer\n\n     [^g]: mid\n\n       [r]: /url\nTAILWORD\n\nx[^f] [^g] [t][r]\n',
    )
    expect(owner(html)).toBe('body')
  })

  /**
   * The narrowing that keeps corpus 447 passing: only a FOOTNOTE body keeps a
   * nested note authored. Inside a list item an over-indented note is still
   * rebased, so it registers rather than rendering as text.
   */
  it('still collects an over-indented note inside a list item', () => {
    const html = carveToHtml('- x\n\n    [^n]: note text\n\nSee [^n].\n')
    expect(html).toContain('href="#fn1"')
    expect(html).not.toContain('[^n]: note text')
  })
})
