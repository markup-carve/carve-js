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

/**
 * THE MECHANISM ITSELF, not one of its consequences.
 *
 * Every case above pins a CHARACTER surviving. None of them pins the reason it
 * survives: that `pickSentinels` chooses a run the document does not contain.
 * A writer with FIXED sentinels passes the whole file above as long as the
 * fixed run is the one those cases avoid - which is how a hardcoded U+E006 was
 * added to this writer while all 12396 tests stayed green, and only carve-php's
 * `FixedInBandSentinelsCollideWithAuthoredContentTest` caught it
 * (carve-js#1276).
 *
 * So these rows hand the writer documents that OCCUPY the runs it would like to
 * use, and they are stated on the bytes: every sentinel is a private-use
 * character, invisible in a rendered-string comparison, which is exactly how the
 * defect hid.
 */

/** The code points `from`..`to`, joined. */
const codePointRun = (from: number, to: number): string => {
  let text = ''
  for (let code = from; code <= to; code++) text += String.fromCharCode(code)
  return text
}

const PREFERRED_RUN = codePointRun(0xe001, 0xe004)
const FIRST_FALLBACK_RUN = codePointRun(0xe005, 0xe008)
const SECOND_FALLBACK_RUN = codePointRun(0xe009, 0xe00c)

/**
 * A document that OCCUPIES `occupied` and, in the same breath, needs all four
 * sentinels to do their job: a trailing space, a blank line, a trailing tab and
 * an authored nbsp marker, all inside verbatim content. Both roles at once is
 * the point - a run the writer picks has to be free of the authored characters
 * AND still carry the four things the sentinels exist to carry.
 */
const occupying = (occupied: string) =>
  '```\n' + 'a' + occupied + 'z  \n' + '\n' + 'b\t\n' + '\ue000\n' + '```\n'

describe('the writer picks its sentinels rather than fixing them', () => {
  it('round-trips a document holding the whole preferred run', () => {
    // U+E001..U+E004 - every code point the writer reaches for first. A fixed
    // writer rewrites them here: space, tab, nothing, and a no-break space.
    const src = occupying(PREFERRED_RUN)

    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('round-trips a document holding the preferred run AND the first fallback run', () => {
    // THE ROW THAT DOES THE REAL WORK. The row above passes against a writer
    // that gives up after one attempt and takes U+E005..U+E008 unchecked; this
    // one occupies that run too, so only a writer that SCANS on to a free run
    // survives it.
    const src = occupying(PREFERRED_RUN + FIRST_FALLBACK_RUN)

    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('still takes the preferred run when the document does not contain it', () => {
    // CONTROL, and an observable one: the document occupies the first TWO
    // fallback runs and leaves U+E001..U+E004 free. It can only round-trip if
    // the writer prefers the free preferred run over scanning forward from
    // U+E005 - so the common case has not moved, and the two rows above did not
    // pass by making every document take the slow path.
    const src = occupying(FIRST_FALLBACK_RUN + SECOND_FALLBACK_RUN)

    expect(carveToCarve(src)).toBe(src)
    expect(carveToHtml(carveToCarve(src))).toBe(carveToHtml(src))
  })

  it('round-trips the same document with no private-use characters at all', () => {
    // CONTROL. Passes before and after every mutation of this defect: it says
    // the four sentinels still carry what they exist to carry, so a run that
    // satisfied the rows above by DELETING the sentinel mechanism cannot pass.
    const src = occupying('')

    expect(carveToCarve(src)).toBe(src)
    expect(src).toContain('  \n')
  })

  for (const [name, code] of [
    ['space', 0xe001],
    ['tab', 0xe002],
    ['blank-line', 0xe003],
    ['nbsp-carrier', 0xe004],
  ] as const) {
    it(`keeps an authored U+${code.toString(16).toUpperCase()}, the ${name} sentinel, out of its own restore pass`, () => {
      // One row per sentinel, so a failure names WHICH restore rewrote the
      // author's character. U+E004 is the one the file above never covered: it
      // arrived with the fourth sentinel (carve-js#688) and had no row of its
      // own.
      const src = occupying(String.fromCharCode(code))

      expect(carveToCarve(src)).toBe(src)
    })
  }
})
