// Character tests of the inline scan. ASCII is decided by comparisons; the Unicode classes are
// read from the engine's tables only for a character outside ASCII, which is off the hot path.
// C2-I-127: the tables are those of data/unicode-categories.json, never the runtime's.
import { DIGIT_0, DIGIT_9, HYPHEN, LF, LOWER_A, LOWER_Z, SPACE, TAB, UNDERSCORE, UPPER_A, UPPER_Z } from './chars.ts'
import { FORMAT_RANGES, LETTER_OR_NUMBER_RANGES, LETTER_RANGES, MARK_RANGES, NUMBER_RANGES } from './unicode-tables.ts'

/** The start and the end of a content, which count as whitespace. */
export const NO_CHARACTER = -1

const ASCII = 128
const HIGH_SURROGATE = 0xd800
const LOW_SURROGATE = 0xdc00
const SURROGATE_END = 0xe000
const ZERO_WIDTH_JOINER = 0x200d
// C2-I-050: the variation selectors, which are marks of category Mn too.
const SELECTORS_FIRST = 0xfe00
const SELECTORS_LAST = 0xfe0f
const SUPPLEMENT_FIRST = 0xe0100
const SUPPLEMENT_LAST = 0xe01ef
const CONTROL_LAST = 0x9f
const DELETE = 0x7f
// White_Space outside ASCII; a stable property: U+0085, U+00A0, U+1680, U+2000-U+200A, U+2028, U+2029, U+202F, U+205F, U+3000.
const WHITE_SPACE_RANGES: readonly number[] = [
  0x85, 0x85, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028, 0x2029, 0x202f, 0x202f, 0x205f, 0x205f, 0x3000, 0x3000,
]

/** Whether `code` lies in one of the sorted inclusive ranges of `ranges`. */
export function inRanges(ranges: readonly number[], code: number): boolean {
  let low = 0
  let high = (ranges.length >> 1) - 1
  while (low <= high) {
    const middle = (low + high) >> 1
    if (code < ranges[middle * 2]!) high = middle - 1
    else if (code > ranges[middle * 2 + 1]!) low = middle + 1
    else return true
  }
  return false
}

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
  return inRanges(LETTER_OR_NUMBER_RANGES, code)
}

/** A Unicode number (general category N). */
export function isNumber(code: number): boolean {
  if (code < ASCII) return isAsciiDigit(code)
  return inRanges(NUMBER_RANGES, code)
}

/** A Unicode letter (general category L). */
export function isLetter(code: number): boolean {
  if (code < ASCII) return isAsciiLetter(code)
  return inRanges(LETTER_RANGES, code)
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
  return code === ZERO_WIDTH_JOINER || inRanges(MARK_RANGES, code) || (code >= SELECTORS_FIRST && code <= SELECTORS_LAST) ||
    (code >= SUPPLEMENT_FIRST && code <= SUPPLEMENT_LAST)
}

/** C2-I-122: a character outside ASCII that a URL may hold: no whitespace, no control and no format character. */
export function isUrlCharacter(code: number): boolean {
  // Cc is U+0000-U+001F and U+007F-U+009F; the ASCII White_Space characters are controls or the space.
  if (code < ASCII) return code > SPACE && code !== DELETE
  if (code <= CONTROL_LAST) return false
  return !inRanges(FORMAT_RANGES, code) && !inRanges(WHITE_SPACE_RANGES, code)
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

// ES2024 methods, in Node since 20 (the `engines` floor); the ES2022 lib of the build does not declare them.
declare global {
  interface String {
    isWellFormed(): boolean
    toWellFormed(): string
  }
}

/** C2-B-218: `text` with each unpaired surrogate read as U+FFFD. Both are one code unit, so every offset stays. */
export function withoutUnpairedSurrogates(text: string): string {
  return text.isWellFormed() ? text : text.toWellFormed()
}
