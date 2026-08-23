import { describe, expect, it } from 'vitest'

import { carveToCarve, carveToHtml, parse, renderCarve } from '../src/index.js'

/*
 * PART 11 SECTION 1: WHAT THE WRITER EMITS RE-RENDERS TO THE SAME DOCUMENT
 * (carve-js#1338).
 *
 * A code fence whose payload holds a WIDER fence run does not nest - section
 * 2's `len(close) >= len(open)` close means the inner run closes the outer at
 * once. That part is correct. What was wrong is what the writer did with the
 * leftovers, which parse as an UNCLOSED verbatim opener: a code span whose
 * value opens with a line terminator and ends with a backtick run.
 *
 * For such a value the closed spelling does not exist. The padding pair is
 * required because content touching a backtick would otherwise merge with the
 * delimiter, and the LEADING pad has nowhere to live: it lands in the last
 * column of the opener's line, where PART 2's no-trailing-whitespace rule takes
 * it - on the way out, and again on the way back in, because the block layer
 * strips a line's trailing run before the inline scanner sees the backticks.
 * What came back was the value plus the TRAILING pad, so the space re-rendered
 * as content inside the code span.
 *
 * WIDENING THE FENCE IS NOT THE FIX, and measuring says so: an opener of any
 * length D sits against a content-final run of N and reads back as a single run
 * of N+D, which is never D, so a wider fence does not close at all. `safeFence`
 * was already picking the right width. The spelling that works is the parser's
 * own - "an opener with no equal-length closer is opaque to the end of the
 * string" - so the bare opener spells it, which is also how the source that
 * produces this tree was written in the first place.
 *
 * WHY NOTHING CAUGHT IT. `fmt(fmt(x)) == fmt(x)` holds, so the bad form is
 * stable; both renders are plausible HTML; and only a BYTE comparison of
 * `toHtml(src)` against `toHtml(fmt(src))` separates them. Every assertion
 * below is that byte comparison.
 */
describe('a verbatim span touching a fence run round-trips', () => {
  const invariant = (src: string) => {
    const out = carveToCarve(src)
    // Section 1: the written form renders the same document.
    expect(carveToHtml(out)).toBe(carveToHtml(src))
    // And it is stable, so a second pass cannot drift.
    expect(carveToCarve(out)).toBe(out)
    return out
  }

  describe('a code fence whose payload holds a wider run', () => {
    it('round-trips with a three-backtick fence over a four-backtick run', () => {
      const out = invariant('```\n````\nx\n````\n```\n')
      // The leftovers are written as the bare opener they were authored as,
      // NOT as a same-width fence plus a separator space.
      expect(out.endsWith('x\n````\n```\n')).toBe(true)
      expect(out).not.toContain('``` ````')
    })

    it('round-trips over a five-backtick run', () => {
      invariant('```\n`````\nx\n`````\n```\n')
    })

    it('round-trips over a six-backtick run', () => {
      invariant('```\n``````\nx\n``````\n```\n')
    })

    it('round-trips the tilde-fenced equivalent', () => {
      invariant('~~~\n~~~~\nx\n~~~~\n~~~\n')
      invariant('~~~\n~~~~~\nx\n~~~~~\n~~~\n')
    })

    it('leaves the nesting direction that WORKS alone', () => {
      // A wider outer fence really nests, and is written back untouched.
      expect(carveToCarve('````\n```\nx\n```\n````\n')).toBe('````\n```\nx\n```\n````\n')
      invariant('````\n```\nx\n```\n````\n')
    })
  })

  describe('the value the writer has to spell', () => {
    const lastCode = (src: string) => {
      const inlines = parse(src).children[0]?.children ?? []
      return inlines.find((node) => node.type === 'code')?.value
    }

    it('is a code span opening with a newline and ending in a backtick run', () => {
      expect(lastCode('x\n````\n```\n')).toBe('\n```')
    })

    it('is written back as itself for runs of three, four and five', () => {
      for (const run of ['```', '````', '`````']) {
        const value = `\n${run}`
        const doc = {
          type: 'document' as const,
          children: [
            {
              type: 'paragraph' as const,
              children: [
                { type: 'text' as const, value: 'x' },
                { type: 'soft_break' as const },
                { type: 'code' as const, value },
              ],
            },
          ],
        }
        const src = renderCarve(doc)
        expect(lastCode(src)).toBe(value)
      }
    })
  })

  describe('where the bare opener is NOT the spelling', () => {
    /*
     * The form is offered only where it cannot mean something else. These pin
     * the guards, so a later widening has to move a test rather than a comment.
     */
    it('is not used where the span would open the block, which is a fence', () => {
      // At the start of a paragraph the same run at column 0 is a code FENCE
      // and not a span at all, so the closed form stays - it does not
      // round-trip, but the tree is one no parse produces (see below).
      const src = renderCarve({
        type: 'document',
        children: [{ type: 'paragraph', children: [{ type: 'code', value: '\n```' }] }],
      })
      expect(src).toContain('``` ````')
    })

    it('is not used when an attribute block follows the span', () => {
      const src = renderCarve({
        type: 'document',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', value: 'x' },
              { type: 'soft_break' },
              { type: 'code', value: '\n```', attrs: { classes: ['k'] } },
            ],
          },
        ],
      })
      // The attributes are written after the span, so the opener may not run to
      // the end of the text.
      expect(src).toContain('{.k}')
      expect(src).toContain('``` ````')
    })
  })

  describe('the shapes that survive the change unchanged', () => {
    it('keeps padding an ordinary backtick-touching span', () => {
      // Single-line content still takes the pad, which is where it works.
      expect(carveToCarve('a `` `b` `` c\n')).toBe('a `` `b` `` c\n')
      invariant('a `` `b` `` c\n')
    })

    it('keeps every colon-fence direction', () => {
      invariant('::: note\nx\n:::\n')
      invariant(':::: note\n::: tip\nx\n:::\n::::\n')
    })

    it('keeps a span inside a quote and inside a list item', () => {
      invariant('> x\n> ````\n> ```\n')
      invariant('- x\n  ````\n  ```\n')
    })

    it('keeps a line block, where the same value is spellable too', () => {
      invariant('::: |\nx\n````\n```\n:::\n')
    })
  })
})
