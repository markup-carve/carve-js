import { describe, it, expect } from 'vitest'
import { carveToCarve, carveToHtml } from '../src/index.js'

/**
 * A code block reproduces arbitrary bytes, so `fmt` may not rewrite them.
 *
 * The writer protected verbatim content with the FIXED sentinels U+E001..U+E003.
 * An author who wrote one of those in a code block had it silently rewritten on
 * the way out: U+E001 became a space, U+E002 a tab, U+E003 nothing at all. Three
 * of those are worse than a deletion, because a space or a tab in a code block is
 * plausible content and the diff reads as whitespace (carve#678).
 *
 * The sentinels are now chosen per render from code points the document does not
 * contain, which cannot collide by construction.
 *
 * U+E000 is deliberately NOT covered here. It is the parser's in-band marker for
 * a non-breaking space, shared with the HTML, plain, ANSI and Markdown renderers,
 * so an authored U+E000 is already conflated with a parsed nbsp before the writer
 * runs - `carveToHtml` alone turns it into `&nbsp;`. That is the other half of
 * carve#678 and wants a decision about what the parsed text of an nbsp is.
 */

const PUA = {
  space: '\ue001',
  tab: '\ue002',
  blank: '\ue003',
} as const

const codeBlock = (middle: string) => '```\na' + middle + 'z\n```\n'

describe('fmt preserves private-use characters in a code block', () => {
  for (const [name, ch] of Object.entries(PUA)) {
    it(`keeps the ${name} sentinel (U+${ch.charCodeAt(0).toString(16).toUpperCase()})`, () => {
      const src = codeBlock(ch)

      // Byte equality, not "contains": the point is that nothing was substituted.
      expect(carveToCarve(src)).toBe(src)
    })
  }

  it('keeps all three at once', () => {
    const src = codeBlock(PUA.space + PUA.tab + PUA.blank)
    expect(carveToCarve(src)).toBe(src)
  })

  it('keeps one on a line of its own, where it used to vanish', () => {
    // The shape carve#678 reported: a line holding only U+E003 came back empty.
    const src = '```\na\n' + PUA.blank + '\nb\n```\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('holds the HTML equal across the round trip (PART 11 §1)', () => {
    const src = codeBlock(PUA.space + PUA.tab + PUA.blank)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })
})

describe('the sentinels still do their job', () => {
  it('a blank line inside a code block survives', () => {
    // What U+E003 exists for: without it the whole-document trim eats the line.
    const src = '```\na\n\nb\n```\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('trailing spaces and tabs inside a code block survive', () => {
    // What U+E001/U+E002 exist for. Written with explicit escapes so the
    // trailing whitespace cannot be stripped by an editor reading this file.
    const src = '```\na' + ' \t' + '\nb\n```\n'
    expect(carveToCarve(src)).toBe(src)
  })

  it('and they still work when the document also contains them as content', () => {
    // Both roles at once: the document holds a literal U+E001 AND needs a real
    // trailing-space sentinel. The chosen trio must avoid the authored one.
    const src = '```\na' + PUA.space + '\nb  \nc\n```\n'
    expect(carveToCarve(src)).toBe(src)
  })
})
