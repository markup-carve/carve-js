import { paragraph as requireParagraph } from './helpers/ast.js'
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
 * An unclosed span keeps the value without padding. A one- or two-backtick
 * opener avoids becoming a block fence when its run is absent from the value.
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
      expect(out.endsWith('x\n`\n```\n')).toBe(true)
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
      const inlines = requireParagraph(parse(src).children[0]).children
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

  describe('block boundaries and attributed spans', () => {
    /*
     * The form is offered only where it cannot mean something else. These pin
     * the guards, so a later widening has to move a test rather than a comment.
     */
    it('uses a short opener at the start of a block to avoid a block fence', () => {
      const out = renderCarve({
        type: 'document',
        children: [{ type: 'paragraph', children: [{ type: 'code', value: '\n```' }] }],
      })
      expect(out).toBe('`\n```\n')
      expect(requireParagraph(parse(out).children[0]).children).toMatchObject([{ type: 'code', value: '\n```' }])
    })

    it('refuses a span whose attributes need a closing fence', () => {
      expect(() => renderCarve({
        type: 'document',
        children: [{ type: 'paragraph', children: [
          { type: 'text', value: 'x' },
          { type: 'soft_break' },
          { type: 'code', value: '\n```', attrs: { classes: ['k'] } },
        ] }],
      })).toThrow(/cannot spell code/)
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
