// Character tests of the inline scan. ASCII is decided by comparisons; the Unicode classes are
// read from the engine's tables only for a character outside ASCII, which is off the hot path.
import { DIGIT_0, DIGIT_9, LF, LOWER_A, LOWER_Z, SPACE, TAB, UPPER_A, UPPER_Z } from './chars.ts'

/** The start and the end of a content, which count as whitespace. */
export const NO_CHARACTER = -1

const ASCII = 128
const HIGH_SURROGATE = 0xd800
const LOW_SURROGATE = 0xdc00
const SURROGATE_END = 0xe000
const ZERO_WIDTH_JOINER = 0x200d
const LETTER_OR_NUMBER = /[\p{L}\p{N}]/u
const COMBINING = /[\p{M}\u{fe00}-\u{fe0f}\u{e0100}-\u{e01ef}]/u
const FORMAT_OR_CONTROL = /[\p{Cc}\p{Cf}]/u

export function isAsciiLetter(code: number): boolean {
  return (code >= LOWER_A && code <= LOWER_Z) || (code >= UPPER_A && code <= UPPER_Z)
}

export function isAsciiDigit(code: number): boolean {
  return code >= DIGIT_0 && code <= DIGIT_9
}

/** A Unicode letter or number (general category L or N). */
export function isWordCharacter(code: number): boolean {
  if (code < ASCII) return isAsciiLetter(code) || isAsciiDigit(code)
  return LETTER_OR_NUMBER.test(String.fromCodePoint(code))
}

/** A space, a tab, a line break, or the edge of the content. */
export function isWhitespace(code: number): boolean {
  return code === SPACE || code === TAB || code === LF || code === NO_CHARACTER
}

/** C2-I-050: a combining mark, a variation selector or a zero-width joiner. */
export function isJoining(code: number): boolean {
  if (code < ASCII) return false
  return code === ZERO_WIDTH_JOINER || COMBINING.test(String.fromCodePoint(code))
}

/** C2-I-073: a character outside ASCII that a URL may hold. */
export function isUrlCharacter(code: number): boolean {
  return !FORMAT_OR_CONTROL.test(String.fromCodePoint(code))
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
