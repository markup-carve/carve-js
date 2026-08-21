import { describe, it, expect } from 'vitest'
import { carveToMarkdown } from '../src/index.js'

/**
 * The Markdown target's escape CARRIERS are picked per document, not fixed.
 *
 * PART 11 §8a and §8b decide three escapes - `_`, `#` and `[` - on the EMITTED
 * LINE rather than on the node, so the writer carries the undecided candidates
 * to the line inside private-use markers and resolves them there. The markers
 * were the fixed run U+E004..U+E008, and two passes then DELETED anything left
 * in that range on the way in. An author who wrote one of those five code
 * points lost it outright, and only on this target - which is what says it was
 * the writer's marker rather than a decision about the character
 * (carve-js#1281).
 *
 * PART 9 §29 already settled the same question for the C0 controls: every
 * character that is not one of the four whitespace characters is CONTENT
 * (PART 7), and a target that silently deletes content is lossy rather than
 * safe. These five are the same decision.
 *
 * The remedy is carve#678's, the one the canonical writer already runs: pick
 * the carriers from code points the document does not contain. Then no authored
 * character can be one, and the deletion the strip existed for has nothing left
 * to do.
 *
 * Every character here is written as a code point rather than as a literal: a
 * private-use character is invisible in a rendered string, which is exactly how
 * the defect hid.
 */

const at = (code: number): string => String.fromCharCode(code)

describe('the Markdown target keeps an authored private-use character', () => {
  for (let code = 0xe001; code <= 0xe00a; code++) {
    const label = `U+${code.toString(16).toUpperCase()}`

    it(`keeps ${label} in a paragraph`, () => {
      expect(carveToMarkdown(`a${at(code)}b\n`)).toContain(at(code))
    })

    it(`keeps ${label} in a code block, where the bytes are the point`, () => {
      expect(carveToMarkdown('```\na' + at(code) + 'z\n```\n')).toContain(at(code))
    })
  }

  it('keeps a whole run at once', () => {
    let text = ''
    for (let code = 0xe001; code <= 0xe00c; code++) text += at(code)

    expect(carveToMarkdown(`a${text}b\n`)).toContain(text)
  })

  it('keeps one next to the characters the carriers stand for', () => {
    // The carriers ride the same line as the candidates they defer. A document
    // that holds both is where a picked run has to be free of the authored
    // characters AND still carry the three decisions.
    let text = ''
    for (let code = 0xe004; code <= 0xe008; code++) text += at(code)
    const out = carveToMarkdown(`${text} company_id and a __b\n`)

    expect(out).toContain(text)
    expect(out).toContain('company_id')
    expect(out).toContain('\\_\\_b')
  })
})

/**
 * THE CARRIERS' REASON, which a run that deleted the mechanism would re-break.
 *
 * §8a decides on the emitted line, so the underscore inside an identifier keeps
 * no escape and a doubled one adjacent to a live delimiter does. §8b M2b asks
 * where on the line a hash stands, and M2b's answer has to survive the
 * container that puts a prefix in front of the line (carve#1330).
 */
describe('the deferred escape decisions still run on the emitted line', () => {
  const rows: ReadonlyArray<readonly [string, string, string]> = [
    ['an underscore inside an identifier keeps no escape', 'company_id\n', 'company_id\n'],
    ['a doubled underscore adjacent to a delimiter keeps one', 'a __b\n', 'a \\_\\_b\n'],
    ['a hash away from the content position drops its escape', 'a \\# b\n', 'a # b\n'],
    ['a hash at the content position keeps it', '\\# literal\n', '\\# literal\n'],
    ['and keeps it under a container prefix', '> \\# quoted\n', '> \\# quoted\n'],
    ['a bracket keeps its escape', 'a \\[b\\] c\n', 'a \\[b\\] c\n'],
  ]

  for (const [name, src, expected] of rows) {
    it(name, () => {
      expect(carveToMarkdown(src)).toBe(expected)
    })
  }

  for (let code = 0xe004; code <= 0xe008; code++) {
    const label = `U+${code.toString(16).toUpperCase()}`

    it(`decides them the same way with an authored ${label} on the line`, () => {
      // Both roles at once: the document occupies a carrier AND needs every
      // decision above. The picked run has to move without moving an answer.
      const carrier = at(code)
      expect(carveToMarkdown(`${carrier}company_id\n`)).toBe(`${carrier}company_id\n`)
      expect(carveToMarkdown(`${carrier} a __b\n`)).toBe(`${carrier} a \\_\\_b\n`)
      // The carrier goes AFTER the hash here. A private-use character is
      // content, so one in FRONT of the hash takes it off the line's content
      // position and M2b drops the escape - correctly, and for a reason that
      // has nothing to do with which code point carries the decision.
      expect(carveToMarkdown(`\\# literal ${carrier}\n`)).toBe(`\\# literal ${carrier}\n`)
    })
  }
})

/**
 * The C1 block and DEL are NOT the same decision, and stay stripped.
 *
 * They sit outside PART 9 §29 by T5, and CSI (U+009B) and OSC (U+009D) are
 * single-character forms of the sequences §25 exists to stop. A run that
 * widened the narrowing above into "strip nothing" would pass every row in this
 * file except these.
 */
describe('the narrowing does not reach the controls §29 excludes', () => {
  for (const code of [0x007f, 0x0080, 0x009b, 0x009d, 0x009f]) {
    it(`still drops U+${code.toString(16).toUpperCase().padStart(4, '0')}`, () => {
      expect(carveToMarkdown(`a${at(code)}b\n`)).toBe('ab\n')
    })
  }
})
