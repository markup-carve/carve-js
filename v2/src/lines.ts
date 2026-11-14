// Line-shape tests. Each reads character codes of the source between `pos` and `end`
// (the end of the line) and copies nothing.
import { type AttributeSink, emptyMemo, readAttributeBlock } from './attributes.ts'
import {
  APOSTROPHE, BACKSLASH, BACKTICK, BANG, BRACE_CLOSE, BRACE_OPEN, BRACKET_CLOSE, BRACKET_OPEN, CARET, COLON, DIGIT_0,
  DOLLAR, DOT, EQUALS, GREATER, HASH, HYPHEN, LOWER_A, LOWER_I, LOWER_X, LOWER_Z, PAREN_CLOSE, PAREN_OPEN,
  PERCENT, PIPE, PLUS, QUESTION, QUOTE_MARK, SLASH, SPACE, STAR, TILDE, UNDERSCORE, UPPER_A, UPPER_X, UPPER_Z,
} from './chars.ts'
import { readInclude } from './include.ts'
import { isSpaceOrTab } from './source.ts'
import { isAsciiDigit } from './unicode.ts'

const MAX_HEADING_LEVEL = 6
const MAX_ORDERED_DIGITS = 9
const MAX_ORDERED_LETTERS = 9
const MIN_RUN_LENGTH = 3
const TASK_BOX_LENGTH = 4
const FRONTMATTER_RUN = 3

export function skipSpaces(src: string, pos: number, end: number): number {
  while (pos < end && isSpaceOrTab(src.charCodeAt(pos))) pos++
  return pos
}

/** Length of the run of `code` at `pos`. */
export function runLength(src: string, pos: number, end: number, code: number): number {
  let p = pos
  while (p < end && src.charCodeAt(p) === code) p++
  return p - pos
}

/** C2-B-031: `>` followed by a space or by the end of the line. */
export function isQuoteMark(src: string, pos: number, end: number): boolean {
  if (pos >= end || src.charCodeAt(pos) !== GREATER) return false
  return pos + 1 === end || src.charCodeAt(pos + 1) === SPACE
}

/** Offset after the `spaces` spaces of a marker that ends at `markerEnd`, or -1 (C2-B-006, C2-B-033). */
function afterMarkerSpace(src: string, markerEnd: number, end: number, spaces: number): number {
  const contentStart = markerEnd + spaces
  if (contentStart > end || runLength(src, markerEnd, contentStart, SPACE) !== spaces) return -1
  return skipSpaces(src, contentStart, end) < end ? contentStart : -1
}

/** Offset after the brace block at `pos`, or -1. A quoted value may hold a closing brace. */
function braceBlockEnd(src: string, pos: number, end: number): number {
  if (pos + 1 >= end || src.charCodeAt(pos) !== BRACE_OPEN) return -1
  const first = src.charCodeAt(pos + 1)
  // `{%` starts a braced comment and `{{` an include directive.
  if (first === PERCENT || first === BRACE_OPEN || first === BRACE_CLOSE) return -1
  for (let p = pos + 1; p < end; p++) {
    const code = src.charCodeAt(p)
    if (code === BRACE_OPEN) return -1
    if (code === BRACE_CLOSE) return p + 1
    if (code !== QUOTE_MARK) continue
    const after = quotedEnd(src, p, end)
    if (after < 0) return -1
    p = after - 1
  }
  return -1
}

/** Offset after the glued brace blocks at `pos`; `pos` itself when there are none (C2-B-093). */
export function braceBlocksEnd(src: string, pos: number, end: number): number {
  for (;;) {
    const next = braceBlockEnd(src, pos, end)
    if (next < 0) return pos
    pos = next
  }
}

/** C2-B-090: one or more glued brace blocks, each a valid attribute block, alone on the line. */
export function isAttributeLine(src: string, pos: number, end: number): boolean {
  const blocksEnd = braceBlocksEnd(src, pos, end)
  if (blocksEnd === pos || skipSpaces(src, blocksEnd, end) !== end) return false
  const memo = emptyMemo()
  let p = pos
  while (p >= 0 && p < blocksEnd) p = readAttributeBlock(src, p, blocksEnd, memo, null)
  return p === blocksEnd
}

/** C2-B-156, C2-B-201, C2-B-206: an include directive alone on its line. */
export function isIncludeLine(src: string, pos: number, end: number): boolean {
  return readInclude(src, pos, end) !== null
}

/** Offset after the space of the bullet marker at `pos`, or -1. Brace blocks may abut the marker (C2-B-034, C2-B-101). */
export function bulletMarkerEnd(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code !== HYPHEN && code !== STAR) return -1
  return afterMarkerSpace(src, braceBlocksEnd(src, pos + 1, end), end, 1)
}

function isLower(code: number): boolean {
  return code >= LOWER_A && code <= LOWER_Z
}

function isUpper(code: number): boolean {
  return code >= UPPER_A && code <= UPPER_Z
}

/** Value of the roman letter `code` in either case, or 0. */
export function romanLetterValue(code: number): number {
  switch (code | 32) {
    case 105: return 1
    case 118: return 5
    case 120: return 10
    case 108: return 50
    case 99: return 100
    case 100: return 500
    case 109: return 1000
    default: return 0
  }
}

/** Offset after the one to nine digits at `pos`, or -1. */
function digitsEnd(src: string, pos: number, end: number): number {
  let p = pos
  while (p < end && isAsciiDigit(src.charCodeAt(p))) p++
  return p - pos > MAX_ORDERED_DIGITS ? -1 : p
}

const CASE_BIT = 0x20

/** Offset after one decimal place of a roman numeral: `one`, `five` and `ten` are its lowercase letters. */
function romanPlaceEnd(src: string, pos: number, end: number, one: number, five: number, ten: number): number {
  const first = pos < end ? src.charCodeAt(pos) | CASE_BIT : 0
  const second = pos + 1 < end ? src.charCodeAt(pos + 1) | CASE_BIT : 0
  if (first === one && (second === ten || second === five)) return pos + 2
  let p = first === five ? pos + 1 : pos
  const limit = p + 3
  while (p < end && p < limit && (src.charCodeAt(p) | CASE_BIT) === one) p++
  return p
}

/** C2-B-036: a roman numeral in its standard form, from 1 to 3999. */
function isStandardRoman(src: string, pos: number, end: number): boolean {
  let p = romanPlaceEnd(src, pos, end, 0x6d, 0, 0)
  p = romanPlaceEnd(src, p, end, 0x63, 0x64, 0x6d)
  p = romanPlaceEnd(src, p, end, 0x78, 0x6c, 0x63)
  return romanPlaceEnd(src, p, end, 0x69, 0x76, 0x78) === end
}

/** Offset after the one letter, or the two to nine letters of one case that form a roman numeral, at `pos`, or -1. */
function lettersEnd(src: string, pos: number, end: number): number {
  const lower = isLower(src.charCodeAt(pos))
  let roman = romanLetterValue(src.charCodeAt(pos)) > 0
  let p = pos + 1
  // Two or more letters are a marker only as a roman numeral, so an ordinary word ends the test at once.
  while (p < end && (lower ? isLower(src.charCodeAt(p)) : isUpper(src.charCodeAt(p)))) {
    roman = roman && romanLetterValue(src.charCodeAt(p)) > 0
    if (!roman || p - pos >= MAX_ORDERED_LETTERS) return -1
    p++
  }
  return p - pos === 1 || isStandardRoman(src, pos, p) ? p : -1
}

/**
 * Offset of the delimiter of the ordered marker at `pos`, or -1 (C2-B-036). Before it stand one
 * to nine digits, one letter, two or more roman letters of one case, or nothing before a dot.
 */
export function orderedDelimiter(src: string, pos: number, end: number): number {
  const first = src.charCodeAt(pos)
  let p = pos
  if (isAsciiDigit(first)) p = digitsEnd(src, pos, end)
  else if (isLower(first) || isUpper(first)) p = lettersEnd(src, pos, end)
  if (p < 0 || p >= end) return -1
  const delimiter = src.charCodeAt(p)
  if (delimiter === DOT) return p
  return delimiter === PAREN_CLOSE && p > pos ? p : -1
}

/** Offset after the spaces of the ordered marker whose delimiter is at `delimiter`, or -1. */
export function orderedMarkerEnd(src: string, pos: number, delimiter: number, end: number): number {
  // C2-B-040: one uppercase letter and a dot needs two spaces, so an initial stays text.
  const spaces = src.charCodeAt(delimiter) === DOT && delimiter === pos + 1 && isUpper(src.charCodeAt(pos)) ? 2 : 1
  const content = afterMarkerSpace(src, braceBlocksEnd(src, delimiter + 1, end), end, spaces)
  // C2-B-043: a bare dot before a dot and a space is an ellipsis written with spaces, no marker.
  const ellipsis = content >= 0 && src.charCodeAt(content) === DOT && content + 1 < end && src.charCodeAt(content + 1) === SPACE
  if (delimiter === pos && ellipsis) return -1
  return content
}

/** C2-B-015: the list marker at `pos` is a bullet or an ordered marker with the value 1, so it may open a list in a paragraph. */
export function opensListInParagraph(src: string, pos: number, end: number): boolean {
  if (bulletMarkerEnd(src, pos, end) >= 0) return true
  const delimiter = orderedDelimiter(src, pos, end)
  if (delimiter === pos) return true
  if (isAsciiDigit(src.charCodeAt(pos))) return decimalValue(src, pos, delimiter) === 1
  const letter = src.charCodeAt(pos) | CASE_BIT
  return delimiter === pos + 1 && (letter === LOWER_A || letter === LOWER_I)
}

/** True when a list marker with content stands at `pos`. */
export function isListMarker(src: string, pos: number, end: number): boolean {
  if (bulletMarkerEnd(src, pos, end) >= 0) return true
  const delimiter = orderedDelimiter(src, pos, end)
  return delimiter >= 0 && orderedMarkerEnd(src, pos, delimiter, end) >= 0
}

/** Value of the digits between `pos` and `end`. */
export function decimalValue(src: string, pos: number, end: number): number {
  let value = 0
  for (let p = pos; p < end; p++) value = value * 10 + (src.charCodeAt(p) - DIGIT_0)
  return value
}

/** Value of the roman numeral between `pos` and `end`. */
export function romanValue(src: string, pos: number, end: number): number {
  let value = 0
  for (let p = pos; p < end; p++) {
    const digit = romanLetterValue(src.charCodeAt(p))
    const next = p + 1 < end ? romanLetterValue(src.charCodeAt(p + 1)) : 0
    value += digit < next ? -digit : digit
  }
  return value
}

function isTaskState(code: number): boolean {
  return code === SPACE || code === LOWER_X || code === UPPER_X || code === UNDERSCORE || code === SLASH ||
    code === BANG || code === HYPHEN || code === GREATER || code === QUESTION
}

/** Offset after the space of the task box at `pos`, or -1 (C2-B-046). */
export function taskBoxEnd(src: string, pos: number, end: number): number {
  if (pos + TASK_BOX_LENGTH > end) return -1
  if (src.charCodeAt(pos) !== BRACKET_OPEN || src.charCodeAt(pos + 2) !== BRACKET_CLOSE) return -1
  if (!isTaskState(src.charCodeAt(pos + 1))) return -1
  return afterMarkerSpace(src, pos + 3, end, 1)
}

/** Offset after the space of the term mark `::` at `pos`, or -1 (C2-B-067). */
export function termMarkEnd(src: string, pos: number, end: number): number {
  return runLength(src, pos, end, COLON) === 2 ? afterMarkerSpace(src, pos + 2, end, 1) : -1
}

/** Offset after the space of the description mark `:` at `pos`, or -1 (C2-B-067). */
export function descriptionMarkEnd(src: string, pos: number, end: number): number {
  return runLength(src, pos, end, COLON) === 1 ? afterMarkerSpace(src, pos + 1, end, 1) : -1
}

/** True when a term mark or a description mark with content stands at `pos`. */
export function isDescriptionListMark(src: string, pos: number, end: number): boolean {
  return termMarkEnd(src, pos, end) >= 0 || descriptionMarkEnd(src, pos, end) >= 0
}

/** Heading level of the `=` or `#` run at `pos`, or 0 (C2-B-151, C2-B-152). */
export function headingLevel(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code !== EQUALS && code !== HASH) return 0
  const level = runLength(src, pos, end, code)
  if (level > MAX_HEADING_LEVEL) return 0
  return afterMarkerSpace(src, pos + level, end, 1) < 0 ? 0 : level
}

/** Length of the backtick or tilde run at `pos` when it opens a code fence, or 0 (C2-B-108). */
export function fenceOpenerLength(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code !== BACKTICK && code !== TILDE) return 0
  const length = runLength(src, pos, end, code)
  if (length < MIN_RUN_LENGTH) return 0
  if (code === BACKTICK) {
    // C2-B-118: a backtick in the info string makes the run inline code.
    for (let p = pos + length; p < end; p++) if (src.charCodeAt(p) === BACKTICK) return 0
  }
  return length
}

/** Length of the run of `code` at `pos` when it has three or more characters, or 0 (C2-B-108). */
export function fenceRunLength(src: string, pos: number, end: number, code: number): number {
  const length = runLength(src, pos, end, code)
  return length >= MIN_RUN_LENGTH ? length : 0
}

/** C2-B-014: a line that opens or closes a code fence, a div or a comment block. */
export function isFenceLine(src: string, pos: number, end: number): boolean {
  const code = src.charCodeAt(pos)
  if (code === COLON) return divRunLength(src, pos, end) > 0
  if (code === PERCENT) return fenceRunLength(src, pos, end, code) > 0
  return fenceOpenerLength(src, pos, end) > 0
}

/**
 * Length of the colon run at `pos` when it is a div line, or 0. The run is bare, or a space stands
 * behind it: a name or a sigil glued to the run makes the line text (C2-B-119, C2-B-196).
 */
export function divRunLength(src: string, pos: number, end: number): number {
  const length = fenceRunLength(src, pos, end, COLON)
  const after = pos + length
  return after === end || isSpaceOrTab(src.charCodeAt(after)) ? length : 0
}

function isSigil(src: string, pos: number, end: number): boolean {
  const code = src.charCodeAt(pos)
  if (code !== PIPE && code !== BACKSLASH && code !== GREATER) return false
  return pos + 1 === end || isSpaceOrTab(src.charCodeAt(pos + 1))
}

/** C2-B-109, C2-B-110: a bare run of `code`, at least `minLength` long. */
export function isBareRun(src: string, pos: number, end: number, code: number, minLength: number): boolean {
  const length = runLength(src, pos, end, code)
  return length >= minLength && skipSpaces(src, pos + length, end) === end
}

/** The sigil of a div opener whose colon run ends at `pos`, or 0 for a name or nothing (C2-B-123, C2-B-124). */
export function divSigil(src: string, pos: number, end: number): number {
  const at = skipSpaces(src, pos, end)
  return at < end && isSigil(src, at, end) ? src.charCodeAt(at) : 0
}

/** True when the colon run that ends at `pos` is followed by `figure` and nothing else (C2-B-127). */
export function isFigureName(src: string, pos: number, end: number): boolean {
  const at = skipSpaces(src, pos, end)
  const name = 'figure'
  if (at + name.length > end) return false
  for (let p = 0; p < name.length; p++) if (src.charCodeAt(at + p) !== name.charCodeAt(p)) return false
  // C2-B-127: with a title or a label the opener is a plain div.
  return skipSpaces(src, at + name.length, end) === end
}

/** C2-B-159: three or more stars and nothing else. */
export function isThematicBreak(src: string, pos: number, end: number): boolean {
  return isBareRun(src, pos, end, STAR, MIN_RUN_LENGTH)
}

/** True when a line comment starts at `pos`. Three percent signs open a comment block instead (C2-B-108). */
export function isLineComment(src: string, pos: number, end: number): boolean {
  return runLength(src, pos, end, PERCENT) === 2
}

/** Offset of the content of the caption line at `pos`, or -1 (C2-B-146). */
export function captionContentStart(src: string, pos: number, end: number): number {
  if (pos + 1 >= end || src.charCodeAt(pos) !== CARET || src.charCodeAt(pos + 1) !== SPACE) return -1
  const content = skipSpaces(src, pos + 1, end)
  return content < end ? content : -1
}

/** Offset after `[label]:` at `pos`, or -1. `skip` is the length of what stands before the label. */
function labelEnd(src: string, pos: number, end: number, skip: number, spaces: boolean): number {
  let p = pos + skip
  const start = p
  while (p < end) {
    const code = src.charCodeAt(p)
    if (code === BRACKET_CLOSE) break
    if (code === BRACKET_OPEN || (!spaces && isSpaceOrTab(code))) return -1
    if (code === BACKSLASH) p++
    p++
  }
  if (p === start || p + 1 >= end || src.charCodeAt(p + 1) !== COLON) return -1
  return p + 2
}

/** Offset after the space of the footnote definition marker `[^label]:` at `pos`, or -1 (C2-B-082). */
export function footnoteMarkerEnd(src: string, pos: number, end: number): number {
  if (pos + 1 >= end || src.charCodeAt(pos) !== BRACKET_OPEN || src.charCodeAt(pos + 1) !== CARET) return -1
  // C2-B-082: a footnote label may hold spaces, as the label of its reference does (C2-I-076).
  const marker = labelEnd(src, pos, end, 2, true)
  return marker < 0 ? -1 : afterMarkerSpace(src, marker, end, 1)
}

/**
 * C2-B-083: the end of the destination of a link definition whose tail starts at `p`, or -1. The tail is that of
 * an inline link (C2-I-067, C2-I-068) with a destination of at least one character: a run without whitespace, then
 * optionally exactly one space and a title in double or single quotes, then only spaces.
 */
export function definitionDestinationEnd(src: string, p: number, end: number): number {
  const start = p
  while (p < end && !isSpaceOrTab(src.charCodeAt(p))) p++
  if (p === start) return -1
  const destination = p
  const quote = p + 1 < end && src.charCodeAt(p) === SPACE ? src.charCodeAt(p + 1) : 0
  if (quote === QUOTE_MARK || quote === APOSTROPHE) {
    const after = quotedEnd(src, p + 1, end, quote)
    if (after >= 0 && skipSpaces(src, after, end) === end) return destination
  }
  return skipSpaces(src, p, end) === end ? destination : -1
}

export function isLinkDefinition(src: string, pos: number, end: number): boolean {
  if (pos + 1 >= end || src.charCodeAt(pos) !== BRACKET_OPEN || src.charCodeAt(pos + 1) === CARET) return false
  const marker = labelEnd(src, pos, end, 1, true)
  if (marker < 0 || marker >= end || src.charCodeAt(marker) !== SPACE) return false
  return definitionDestinationEnd(src, skipSpaces(src, marker + 1, end), end) >= 0
}

/** Offset after the quoted string at `pos`, or -1. */
export function quotedEnd(src: string, pos: number, end: number, quote = QUOTE_MARK): number {
  for (let p = pos + 1; p < end; p++) {
    const code = src.charCodeAt(p)
    if (code === BACKSLASH) p++
    else if (code === quote) return p + 1
  }
  return -1
}

/** C2-B-084: `*[label]:` with a label of ASCII letters and digits, a space and an expansion that is not empty. */
export function isAbbreviation(src: string, pos: number, end: number): boolean {
  if (pos + 1 >= end || src.charCodeAt(pos) !== STAR || src.charCodeAt(pos + 1) !== BRACKET_OPEN) return false
  let p = pos + 2
  while (p < end && (isAsciiDigit(src.charCodeAt(p)) || isLower(src.charCodeAt(p)) || isUpper(src.charCodeAt(p)))) p++
  if (p === pos + 2 || p + 1 >= end || src.charCodeAt(p) !== BRACKET_CLOSE || src.charCodeAt(p + 1) !== COLON) return false
  return afterMarkerSpace(src, p + 2, end, 1) >= 0
}

/** True when a definition of any of the three kinds stands at `pos` (C2-B-016). */
export function isDefinition(src: string, pos: number, end: number): boolean {
  return footnoteMarkerEnd(src, pos, end) >= 0 || isLinkDefinition(src, pos, end) || isAbbreviation(src, pos, end)
}

/** Offset after the bracket pair that opens at `pos` with `open`, or -1. */
function pairEnd(src: string, pos: number, end: number, open: number, close: number): number {
  let depth = 0
  for (let p = pos; p < end; p++) {
    const code = src.charCodeAt(p)
    if (code === BACKSLASH) p++
    else if (code === open) depth++
    else if (code === close && --depth === 0) return p + 1
  }
  return -1
}

/** C2-B-197: exactly one image form, `![alt](destination)` or `![alt][label]`, with optional glued brace blocks. */
export function isImageOnly(src: string, pos: number, end: number): boolean {
  if (pos + 1 >= end || src.charCodeAt(pos) !== BANG || src.charCodeAt(pos + 1) !== BRACKET_OPEN) return false
  let p = pairEnd(src, pos + 1, end, BRACKET_OPEN, BRACKET_CLOSE)
  if (p < 0 || p >= end) return false
  const code = src.charCodeAt(p)
  if (code === PAREN_OPEN) p = pairEnd(src, p, end, PAREN_OPEN, PAREN_CLOSE)
  else if (code === BRACKET_OPEN) p = pairEnd(src, p, end, BRACKET_OPEN, BRACKET_CLOSE)
  else return false
  return p >= 0 && skipSpaces(src, braceBlocksEnd(src, p, end), end) === end
}

/** C2-B-198: exactly one display math span, `$$` glued to a code span, with optional glued brace blocks. */
export function isDisplayMathOnly(src: string, pos: number, end: number): boolean {
  if (pos + 2 >= end || src.charCodeAt(pos) !== DOLLAR || src.charCodeAt(pos + 1) !== DOLLAR) return false
  const open = runLength(src, pos + 2, end, BACKTICK)
  if (open === 0) return false
  let p = pos + 2 + open
  while (p < end) {
    if (src.charCodeAt(p) !== BACKTICK) {
      p++
      continue
    }
    const run = runLength(src, p, end, BACKTICK)
    p += run
    if (run === open) return skipSpaces(src, braceBlocksEnd(src, p, end), end) === end
  }
  return false
}

/**
 * C2-B-161, C2-B-164: exactly `---`, then a format name of lowercase letters, digits and hyphens,
 * glued or after one space, or nothing, and trailing spaces.
 */
export function isFrontmatterOpener(src: string, pos: number, end: number): boolean {
  if (runLength(src, pos, end, HYPHEN) !== FRONTMATTER_RUN) return false
  let p = pos + FRONTMATTER_RUN
  const name = p + 1 < end && src.charCodeAt(p) === SPACE ? p + 1 : p
  if (name < end && isLower(src.charCodeAt(name))) {
    p = name + 1
    while (p < end && (isLower(src.charCodeAt(p)) || isAsciiDigit(src.charCodeAt(p)) || src.charCodeAt(p) === HYPHEN)) p++
  }
  return skipSpaces(src, p, end) === end
}

/** C2-B-162: exactly `---` plus trailing spaces and tabs. */
export function isFrontmatterCloser(src: string, pos: number, end: number): boolean {
  if (runLength(src, pos, end, HYPHEN) !== FRONTMATTER_RUN) return false
  return skipSpaces(src, pos + FRONTMATTER_RUN, end) === end
}

/** True when the info string of the fence whose run ends at `pos` is `=` and a format name (C2-B-116). */
export function isRawInfo(src: string, pos: number, end: number): boolean {
  return pos + 1 < end && src.charCodeAt(pos) === EQUALS && (isLower(src.charCodeAt(pos + 1)) || isUpper(src.charCodeAt(pos + 1)))
}

function startsWith(src: string, pos: number, end: number, word: string): boolean {
  if (pos + word.length > end) return false
  for (let p = 0; p < word.length; p++) if (src.charCodeAt(pos + p) !== word.charCodeAt(p)) return false
  return true
}

/** True when the word at `pos` is `word` and ends there. */
export function isWord(src: string, pos: number, end: number, word: string): boolean {
  return startsWith(src, pos, end, word) && (pos + word.length === end || isSpaceOrTab(src.charCodeAt(pos + word.length)))
}

const MAX_COUNT_DIGITS = 9

/**
 * The value of the key `key` on the attribute lines between `pos` and `end`, or null when no block
 * there holds it. The last one written counts (C2-A-035), and a bare key has the empty value.
 */
export function attributeKeyValue(src: string, pos: number, end: number, key: string): string | null {
  const found: { value: string | null } = { value: null }
  const ignore = (): void => undefined
  const sink: AttributeSink = {
    id: ignore, className: ignore, lang: ignore,
    key: (name, value) => {
      if (name === key) found.value = value
    },
  }
  const memo = emptyMemo()
  let p = pos
  while (p < end) {
    const after = src.charCodeAt(p) === BRACE_OPEN ? readAttributeBlock(src, p, end, memo, sink) : -1
    p = after < 0 ? p + 1 : after
  }
  return found.value
}

/** C2-B-210: the count that `value` spells: one or more digits, or 1 for the empty value. -1 for any other value and for null. */
export function countValue(value: string | null): number {
  if (value === null) return -1
  if (value === '') return 1
  for (let p = 0; p < value.length; p++) if (!isAsciiDigit(value.charCodeAt(p))) return -1
  // A count past any table takes every row, so its size is capped and not parsed.
  return value.length > MAX_COUNT_DIGITS ? 10 ** MAX_COUNT_DIGITS : decimalValue(value, 0, value.length)
}

/**
 * Offset of the next pipe that separates cells between `pos` and `end`, or -1 (C2-B-169). A pipe
 * is no separator when it is escaped or stands between a backtick run and its matching closing run.
 */
export function nextPipe(src: string, pos: number, end: number): number {
  let p = pos
  while (p < end) {
    const code = src.charCodeAt(p)
    if (code === PIPE) return p
    if (code === BACKSLASH) {
      p += 2
    } else if (code === BACKTICK) {
      const run = runLength(src, p, end, BACKTICK)
      const close = closingRun(src, p + run, end, run)
      p = close < 0 ? p + run : close + run
    } else {
      p++
    }
  }
  return -1
}

/** Offset of the next backtick run of exactly `length` at or after `pos`, or -1. */
function closingRun(src: string, pos: number, end: number, length: number): number {
  let p = pos
  while (p < end) {
    if (src.charCodeAt(p) !== BACKTICK) {
      p++
      continue
    }
    const run = runLength(src, p, end, BACKTICK)
    if (run === length) return p
    p += run
  }
  return -1
}

/** Offset of the last separating pipe between `pos` and `end`, or -1. */
function lastPipe(src: string, pos: number, end: number): number {
  let last = -1
  for (let p = nextPipe(src, pos, end); p >= 0; p = nextPipe(src, p + 1, end)) last = p
  return last
}

/** Offset of the brace block of the row attribute behind the closing pipe at `pipe`, or -1 (C2-B-167). */
export function rowAttributeStart(src: string, pipe: number, end: number): number {
  let p = pipe + 1
  if (p < end && src.charCodeAt(p) === SPACE) p++
  return braceBlockEnd(src, p, end) < 0 ? -1 : p
}

/**
 * Offset of the closing pipe of the table row at `pos`, or -1 (C2-B-166). The row starts with a
 * pipe and ends with another; a row attribute and a line comment may follow the last pipe (C2-B-167).
 */
export function rowClosingPipe(src: string, pos: number, end: number): number {
  if (src.charCodeAt(pos) !== PIPE) return -1
  const last = lastPipe(src, pos + 1, end)
  if (last < 0) return -1
  const attribute = rowAttributeStart(src, last, end)
  const tail = skipSpaces(src, attribute < 0 ? last + 1 : braceBlocksEnd(src, attribute, end), end)
  return tail === end || isLineComment(src, tail, end) ? last : -1
}

/** Offset of the closing pipe of the continuation row at `pos`, or -1 (C2-B-175, C2-B-177). */
export function continuationClosingPipe(src: string, pos: number, end: number): number {
  if (src.charCodeAt(pos) !== PLUS) return -1
  const last = lastPipe(src, pos + 1, end)
  return last >= 0 && skipSpaces(src, last + 1, end) === end ? last : -1
}

/** Offset of the first bare `#` of a caption's text, the caption number mark, or -1 (C2-B-150). */
export function captionNumberMark(src: string, pos: number, end: number): number {
  let p = pos
  while (p < end) {
    const code = src.charCodeAt(p)
    if (code === HASH) return p
    if (code === BACKSLASH) {
      p += 2
    } else if (code === BACKTICK) {
      const run = runLength(src, p, end, BACKTICK)
      const close = closingRun(src, p + run, end, run)
      p = close < 0 ? p + run : close + run
    } else {
      p++
    }
  }
  return -1
}

/** Offset after the last character between `pos` and `end` that is not a space or a tab. */
export function trimEnd(src: string, pos: number, end: number): number {
  while (end > pos && isSpaceOrTab(src.charCodeAt(end - 1))) end--
  return end
}
