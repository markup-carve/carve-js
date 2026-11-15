// Character tests of the inline scan. ASCII is decided by comparisons; the Unicode classes are
// read from the engine's tables only for a character outside ASCII, which is off the hot path.
import { DIGIT_0, DIGIT_9, HYPHEN, LF, LOWER_A, LOWER_Z, SPACE, TAB, UNDERSCORE, UPPER_A, UPPER_Z } from './chars.ts'

/** The start and the end of a content, which count as whitespace. */
export const NO_CHARACTER = -1

const ASCII = 128
const HIGH_SURROGATE = 0xd800
const LOW_SURROGATE = 0xdc00
const SURROGATE_END = 0xe000
const ZERO_WIDTH_JOINER = 0x200d
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const LETTER = /\p{L}/u
const COMBINING = /[\p{M}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]/u
// C2-I-122: the characters outside ASCII that are no URL characters.
const NO_URL_CHARACTER = /[\p{Cc}\p{Cf}\p{White_Space}]/u

export function isAsciiLetter(code: number): boolean {
  return (code >= LOWER_A && code <= LOWER_Z) || (code >= UPPER_A && code <= UPPER_Z)
}

export function isAsciiDigit(code: number): boolean {
  return code >= DIGIT_0 && code <= DIGIT_9
}

export function isAsciiAlphanumeric(code: number): boolean {
  return isAsciiLetter(code) || isAsciiDigit(code)
}

/** An ASCII letter or digit, `_` or `-`: a character of a name such as a tag or a key. */
export function isAsciiNameCharacter(code: number): boolean {
  return isAsciiAlphanumeric(code) || code === UNDERSCORE || code === HYPHEN
}

/** A Unicode letter or number (general category L or N). */
export function isWordCharacter(code: number): boolean {
  if (code < ASCII) return isAsciiLetter(code) || isAsciiDigit(code)
  return LETTER_OR_NUMBER.test(String.fromCodePoint(code))
}

/** A Unicode letter (general category L). */
export function isLetter(code: number): boolean {
  if (code < ASCII) return isAsciiLetter(code)
  return LETTER.test(String.fromCodePoint(code))
}

/** A space, a tab, a line break, or the edge of the content. */
export function isWhitespace(code: number): boolean {
  return code === SPACE || code === TAB || code === LF || code === NO_CHARACTER
}

export const NO_BREAK_SPACE = 0xa0

/** Whitespace for a test of the character before or after a position: a no-break space counts too. */
export function isBoundarySpace(code: number): boolean {
  return isWhitespace(code) || code === NO_BREAK_SPACE
}

/** C2-I-050: a combining mark, a variation selector or a zero-width joiner. */
export function isJoining(code: number): boolean {
  if (code < ASCII) return false
  return code === ZERO_WIDTH_JOINER || COMBINING.test(String.fromCodePoint(code))
}

/** C2-I-122: a character outside ASCII that a URL may hold: no whitespace, no control and no format character. */
export function isUrlCharacter(code: number): boolean {
  return !NO_URL_CHARACTER.test(String.fromCodePoint(code))
}

export function isAsciiPunctuation(code: number): boolean {
  return (code > SPACE && code < DIGIT_0) || (code > DIGIT_9 && code < UPPER_A) ||
    (code > UPPER_Z && code < LOWER_A) || (code > LOWER_Z && code < ASCII - 1)
}

/** The code point that starts at `pos`, or NO_CHARACTER at `end`. */
export function codePointAt(text: string, pos: number, end: number): number {
  if (pos >= end) return NO_CHARACTER
  const code = text.charCodeAt(pos)
  if (code < HIGH_SURROGATE || code >= LOW_SURROGATE || pos + 1 >= end) return code
  return text.codePointAt(pos)!
}

/** The code point that ends at `pos`, or NO_CHARACTER at the start. */
export function codePointBefore(text: string, pos: number): number {
  if (pos <= 0) return NO_CHARACTER
  const code = text.charCodeAt(pos - 1)
  if (code < LOW_SURROGATE || code >= SURROGATE_END || pos < 2) return code
  const lead = text.charCodeAt(pos - 2)
  return lead >= HIGH_SURROGATE && lead < LOW_SURROGATE ? text.codePointAt(pos - 2)! : code
}

/** C2-H-172: the bidirectional embeddings, overrides and isolates lie in this range. */
export const BIDI_FIRST = 0x202a
export const BIDI_LAST = 0x2069
const BIDI_EMBEDDINGS_LAST = 0x202e
const BIDI_ISOLATES_FIRST = 0x2066

/** C2-H-172: U+202A to U+202E and U+2066 to U+2069. */
export function isBidiControl(code: number): boolean {
  return (code >= BIDI_FIRST && code <= BIDI_EMBEDDINGS_LAST) || (code >= BIDI_ISOLATES_FIRST && code <= BIDI_LAST)
}

/** C2-H-172: true when `text[start, end)` holds a bidirectional control. */
export function holdsBidiControl(text: string, start: number, end: number): boolean {
  for (let at = start; at < end; at++) {
    const code = text.charCodeAt(at)
    if (code >= BIDI_FIRST && code <= BIDI_LAST && isBidiControl(code)) return true
  }
  return false
}

const HIGH_SURROGATE_FIRST = 0xd800
const LOW_SURROGATE_FIRST = 0xdc00
const SURROGATE_LAST = 0xdfff

/** The length of the surrogate pair at `at`, 2, or 0 when the code unit there is an unpaired surrogate. */
function pairLength(text: string, at: number): number {
  const code = text.charCodeAt(at)
  if (code >= LOW_SURROGATE_FIRST) return 0
  const next = text.charCodeAt(at + 1)
  return next >= LOW_SURROGATE_FIRST && next <= SURROGATE_LAST ? 2 : 0
}

/** C2-B-218: `text` with each unpaired surrogate read as U+FFFD. Both are one code unit, so every offset stays. */
export function withoutUnpairedSurrogates(text: string): string {
  let out = ''
  let from = 0
  for (let at = 0; at < text.length; at++) {
    const code = text.charCodeAt(at)
    if (code < HIGH_SURROGATE_FIRST || code > SURROGATE_LAST) continue
    const pair = pairLength(text, at)
    if (pair === 2) {
      at++
      continue
    }
    out += `${text.slice(from, at)}�`
    from = at + 1
  }
  return from === 0 ? text : out + text.slice(from)
}
