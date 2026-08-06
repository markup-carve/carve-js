import { describe, expect, it } from 'vitest'
import { carveToCarve, carveToHtml, carveToMarkdown, carveToPlainText } from '../src/index.js'

/*
 * The writer must not drop a zero-width character it renders.
 *
 * PART 11 §1: `to_html(fmt(x)) == to_html(x)`. Every engine keeps U+FEFF in
 * the HTML - it is an ordinary character there, not whitespace - so a writer
 * that trims it produces a document that renders differently from the one it
 * was given. That makes this a defect rather than a three-engine vote: the
 * invariant decides it, and carve-php and carve-rs keeping the character is
 * corroboration rather than the argument (carve#844, Punkt 3).
 *
 * The cause is that JavaScript's `\s` includes U+FEFF, where Rust's
 * `char::is_whitespace` and PCRE's `\s` do not. The trim is spelled `\s` minus
 * NBSP in three places here, so the character was trimmable in all of them.
 */

const BOM = '﻿'

describe('a zero-width character survives the writer', () => {
  const cases: Array<[string, string]> = [
    ['a paragraph', `hello${BOM}\n`],
    ['a heading', `# T${BOM}\n`],
    ['a link destination', `[r]: https://e.com/${BOM}\n\n[x][r]\n`],
  ]

  for (const [label, source] of cases) {
    it(`renders the same after fmt: ${label}`, () => {
      expect(carveToHtml(carveToCarve(source))).toBe(carveToHtml(source))
    })

    it(`keeps the character in the written source: ${label}`, () => {
      // Stated directly as well as through the invariant, because a future
      // change that dropped the character from BOTH sides would satisfy the
      // round trip while still losing what the author wrote.
      expect(carveToCarve(source)).toContain(BOM)
    })
  }

  it('still trims ordinary trailing whitespace', () => {
    // The control. Widening the trim to keep everything would pass every
    // assertion above.
    expect(carveToCarve('hello   \n')).toBe('hello\n')
  })

  it('still keeps a non-breaking space, which is the trim ORIGINAL exception', () => {
    expect(carveToCarve('hello \n')).toContain(' ')
  })

  it('the other non-HTML targets keep it too', () => {
    // `trimNonNbsp` is shared by every non-HTML target, so the same character
    // was trimmable on each of them.
    expect(carveToMarkdown(`hello${BOM}\n`)).toContain(BOM)
    expect(carveToPlainText(`hello${BOM}\n`)).toContain(BOM)
  })
})
