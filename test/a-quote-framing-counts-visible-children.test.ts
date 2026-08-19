import { describe, expect, it } from 'vitest'
import { carveToHtml } from '../src/index.js'

const html = (source: string) => carveToHtml(source).replace(/\n+$/, '')

/**
 * A block quote with ONE child that renders something is compact; with several
 * it is expanded. A comment (PART 9 §4.13) and a raw block for another target
 * both render '', and counting such a child pushed a single-paragraph quote
 * into the expanded form (markup-carve/carve#1106).
 *
 * The oracle produces the compact form for all three rows below. The same rule
 * already governs list items (carve-js#991); this brings the quote renderer to
 * it. "Renders nothing" is decided by rendering, not by a type list, because
 * two unrelated node types reach it.
 */
describe('a block quote framing counts only visible children', () => {
  it.each([
    ['a line comment first', '> %% c\n> y\n'],
    ['a line comment second', '> y\n> %% c\n'],
    ['a comment fence', '> %%%\n> c\n> %%%\n> y\n'],
    ['a raw block for another target', '> ```=latex\n> \\x\n> ```\n> y\n'],
  ])('%s leaves the quote compact', (_name, source) => {
    expect(html(source)).toBe('<blockquote><p>y</p></blockquote>')
  })

  /**
   * BOUNDS. None moves under the mutation that reverts the fix, so they pin
   * what it must not change rather than proving it.
   */
  describe('unchanged', () => {
    it('a plain quote is already compact', () => {
      expect(html('> x\n')).toBe('<blockquote><p>x</p></blockquote>')
    })

    it('two real paragraphs still expand', () => {
      expect(html('> a\n>\n> b\n')).toBe('<blockquote>\n  <p>a</p>\n  <p>b</p>\n</blockquote>')
    })

    it('a quote holding only a comment is unchanged', () => {
      expect(html('> %% c\n')).toBe('<blockquote>\n\n</blockquote>')
    })
  })

  /**
   * The first attempt tested emptiness by calling `renderBlock` in a filter and
   * then let the expanded path render the same children again. That doubles the
   * work at every nesting level - exponential in depth - and took a 24-deep
   * quote from under a millisecond to 3.6 seconds while a 32-deep one did not
   * finish.
   *
   * A RATIO, not a wall-clock bound: doubling the depth may not multiply the
   * cost by more than a small factor. Exponential would be ~65000x here.
   */
  it('does not render a nested quote more than once per level', () => {
    const nest = (d: number) => {
      let s = 'x'
      for (let i = 0; i < d; i++) s = s.split('\n').map((l) => `> ${l}`).join('\n')
      return `${s}\n`
    }
    const time = (d: number) => {
      const src = nest(d)
      carveToHtml(src) // warm
      const t = performance.now()
      for (let i = 0; i < 20; i++) carveToHtml(src)
      return performance.now() - t
    }
    const shallow = Math.max(time(16), 0.5)
    const deep = time(32)
    expect(deep / shallow).toBeLessThan(10)
  })
})
