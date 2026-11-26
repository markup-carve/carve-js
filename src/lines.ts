// Line-shape tests. Each reads character codes of the source between `pos` and `end`
// (the end of the line) and copies nothing.
import { type AttributeMemo, type AttributeSink, emptyMemo, readAttributeBlock } from './attributes.ts'
import {
  APOSTROPHE, BACKSLASH, BACKTICK, BANG, BRACE_CLOSE, BRACE_OPEN, BRACKET_CLOSE, BRACKET_OPEN, CARET, COLON, DIGIT_0,
  DOLLAR, DOT, EQUALS, GREATER, HASH, HYPHEN, LESS, LOWER_A, LOWER_I, LOWER_V, LOWER_X, LOWER_Z, PAREN_CLOSE,
  PERCENT, PIPE, PLUS, QUESTION, QUOTE_MARK, SLASH, SPACE, STAR, TAB, TILDE, UNDERSCORE, UPPER_A, UPPER_X, UPPER_Z,
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

/** Offset after the `spaces` spaces of a marker that ends at `markerEnd`, or -1 (C2-B-033). */
function afterMarkerSpace(src: string, markerEnd: number, end: number, spaces: number): number {
  const contentStart = markerEnd + spaces
  if (contentStart > end || runLength(src, markerEnd, contentStart, SPACE) !== spaces) return -1
  return skipSpaces(src, contentStart, end) < end ? contentStart : -1
}

/**
 * Offset after the brace block at `pos`, or -1. A quoted value, in either quote, may hold a closing brace
 * and the other quote (C2-I-033), and an unquoted one an opening brace (C2-I-032); whether the block is
 * valid is read by the attribute grammar.
 */
export function braceBlockEnd(src: string, pos: number, end: number, scans?: Map<number, number>): number {
  if (pos + 1 >= end || src.charCodeAt(pos) !== BRACE_OPEN) return -1
  const first = src.charCodeAt(pos + 1)
  // `{%` starts a braced comment and `{{` an include directive.
  if (first === PERCENT || first === BRACE_OPEN || first === BRACE_CLOSE) return -1
  return closingBraceEnd(src, pos + 1, end, scans)
}

/**
 * Offset after the first `}` at or after `from` outside quoted values, or -1. The scan only depends on where it
 * starts, so `scans` keeps the answer for every offset it passes, and a later scan that runs into one stops there.
 */
function closingBraceEnd(src: string, from: number, end: number, scans: Map<number, number> | undefined): number {
  const passed: number[] = []
  let found = -1
  for (let p = from; p < end; p++) {
    const known = scans?.get(p)
    if (known !== undefined) {
      found = known
      break
    }
    if (scans !== undefined) passed.push(p)
    const code = src.charCodeAt(p)
    if (code === BRACE_CLOSE) {
      found = p + 1
      break
    }
    if (code !== QUOTE_MARK && code !== APOSTROPHE) continue
    const after = quotedEnd(src, p, end, code)
    if (after < 0) break
    p = after - 1
  }
  if (scans !== undefined) for (const p of passed) scans.set(p, found)
  return found
}

/** Offset after the glued brace blocks at `pos`; `pos` itself when there are none (C2-B-093). */
export function braceBlocksEnd(src: string, pos: number, end: number): number {
  for (;;) {
    const next = braceBlockEnd(src, pos, end)
    if (next < 0) return pos
    pos = next
  }
}

function isVerticalMark(code: number): boolean {
  return code === CARET || code === TILDE || code === LOWER_V
}

/**
 * C2-B-182: the number of alignment marks after the `{` at `pos`: a horizontal mark and an optional vertical
 * mark directly after it, or `?` and a vertical mark. A vertical mark alone and a `?` alone are no marks.
 */
export function cellMarksLength(src: string, pos: number): number {
  const first = src.charCodeAt(pos + 1)
  const vertical = isVerticalMark(src.charCodeAt(pos + 2)) ? 1 : 0
  if (first === LESS || first === GREATER || first === TILDE) return 1 + vertical
  return first === QUESTION && vertical === 1 ? 2 : 0
}

/** True when the brace block `[pos, blockEnd)` is a valid attribute block; in a cell prefix it may start with alignment marks. */
function isValidBlock(src: string, pos: number, blockEnd: number, memo: AttributeMemo, cell: boolean): boolean {
  // C2-B-182: the marks are read before the parts, and a block of the marks alone is valid.
  const marks = cell ? cellMarksLength(src, pos) : 0
  if (marks > 0 && skipSpaces(src, pos + 1 + marks, blockEnd) === blockEnd - 1) return true
  return readAttributeBlock(src, pos + marks, blockEnd, memo, null) === blockEnd
}

/**
 * Offset after the glued attribute blocks at `pos`, or `pos` when there are none. A brace block that is
 * no valid attribute block (C2-I-034), or an empty one (C2-I-040), ends the run: the blocks before it stand.
 */
export function attributeBlocksEnd(src: string, pos: number, end: number, cell = false): number {
  const memo = emptyMemo()
  let p = pos
  for (;;) {
    const blockEnd = braceBlockEnd(src, p, end)
    // C2-B-182: the marks stand only in the first block of the run.
    if (blockEnd < 0 || !isValidBlock(src, p, blockEnd, memo, cell && p === pos)) return p
    p = blockEnd
  }
}

/** C2-B-090: one or more glued brace blocks, each a valid attribute block, alone on the line. */
export function isAttributeLine(src: string, pos: number, end: number): boolean {
  const blocksEnd = attributeBlocksEnd(src, pos, end)
  return blocksEnd > pos && skipSpaces(src, blocksEnd, end) === end
}

/** C2-B-156, C2-B-201, C2-B-206: an include directive alone on its line. */
export function isIncludeLine(src: string, pos: number, end: number): boolean {
  return readInclude(src, pos, end) !== null
}

/** Offset after the space of the bullet marker at `pos`, or -1. Brace blocks may abut the marker (C2-B-034, C2-B-101). */
export function bulletMarkerEnd(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code !== HYPHEN && code !== STAR) return -1
  return afterMarkerSpace(src, attributeBlocksEnd(src, pos + 1, end), end, 1)
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
  // C2-B-040: an uppercase marker and a dot needs two spaces, so an initial or an abbreviation stays text.
  const spaces = src.charCodeAt(delimiter) === DOT && delimiter > pos && isUpper(src.charCodeAt(pos)) ? 2 : 1
  const content = afterMarkerSpace(src, attributeBlocksEnd(src, delimiter + 1, end), end, spaces)
  if (delimiter !== pos || content < 0) return content
  // C2-B-043: a bare dot whose content, from its first character on, starts with a dot and a space is no marker.
  const first = skipSpaces(src, content, end)
  const ellipsis = src.charCodeAt(first) === DOT && first + 1 < end && src.charCodeAt(first + 1) === SPACE
  return ellipsis ? -1 : content
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

/** Length of the backtick run at `pos` when it opens a code fence, or 0. A tilde run is text (C2-B-108). */
export function fenceOpenerLength(src: string, pos: number, end: number): number {
  if (src.charCodeAt(pos) !== BACKTICK) return 0
  const length = runLength(src, pos, end, BACKTICK)
  if (length < MIN_RUN_LENGTH) return 0
  // C2-B-118: a backtick in the info string makes the run inline code.
  for (let p = pos + length; p < end; p++) if (src.charCodeAt(p) === BACKTICK) return 0
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
  let after = pos + length
  while (after < end && src.charCodeAt(after) === SPACE) after++
  // C2-B-119: behind a space the line opens a div whatever follows; a tab there starts further words (C2-B-122).
  if (after === end || after > pos + length) return length
  // A tab glued to the run leaves it bare or makes the line text.
  if (src.charCodeAt(after) !== TAB) return 0
  return skipSpaces(src, after, end) === end ? length : 0
}

// C2-B-119: a sigil starts a sigil div also when further words are glued to it.
function isSigil(code: number): boolean {
  return code === PIPE || code === BACKSLASH || code === GREATER
}

/** C2-B-109, C2-B-110: a bare run of `code`, at least `minLength` long. */
export function isBareRun(src: string, pos: number, end: number, code: number, minLength: number): boolean {
  const length = runLength(src, pos, end, code)
  return length >= minLength && skipSpaces(src, pos + length, end) === end
}

/** The sigil of a div opener whose colon run ends at `pos`, or 0 for a name or nothing (C2-B-123, C2-B-124). */
export function divSigil(src: string, pos: number, end: number): number {
  let at = pos
  while (at < end && src.charCodeAt(at) === SPACE) at++
  const code = src.charCodeAt(at)
  return at < end && isSigil(code) ? code : 0
}

/** C2-B-159: three or more stars and nothing else. */
export function isThematicBreak(src: string, pos: number, end: number): boolean {
  return isBareRun(src, pos, end, STAR, MIN_RUN_LENGTH)
}

/** True when a line comment starts at `pos`. Three percent signs open a comment block instead (C2-B-108). */
export function isLineComment(src: string, pos: number, end: number): boolean {
  return runLength(src, pos, end, PERCENT) === 2
}

/** C2-B-133: after whitespace inside a line `%%` starts a line comment, so a longer run opens no comment block there. */
export function isInnerLineComment(src: string, pos: number, end: number): boolean {
  return runLength(src, pos, end, PERCENT) >= 2
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
  let solid = false
  while (p < end) {
    const code = src.charCodeAt(p)
    if (code === BRACKET_CLOSE) break
    if (code === BRACKET_OPEN || (!spaces && isSpaceOrTab(code))) return -1
    if (!isSpaceOrTab(code)) solid = true
    if (code === BACKSLASH) p++
    p++
  }
  // C2-I-079: a label whose key folds to nothing is no label.
  if (!solid || p + 1 >= end || src.charCodeAt(p + 1) !== COLON) return -1
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
    if (after >= 0 && definitionTailEnd(src, after, end) >= 0) return destination
  }
  return definitionTailEnd(src, p, end) >= 0 ? destination : -1
}

/**
 * C2-B-083, C2-B-089: behind the destination or the title, optionally exactly one space and one valid attribute
 * block, then only spaces. Returns the start of that block, `end` where there is none, or -1 where the rest is text.
 */
export function definitionTailEnd(src: string, p: number, end: number): number {
  if (skipSpaces(src, p, end) === end) return end
  if (src.charCodeAt(p) !== SPACE || src.charCodeAt(p + 1) !== BRACE_OPEN) return -1
  const block = readAttributeBlock(src, p + 1, end, emptyMemo(), null)
  return block >= 0 && skipSpaces(src, block, end) === end ? p + 1 : -1
}

// C2-B-083: the parts of the tail of a link definition that its first line may leave out.
export const TAIL_TITLE = 1
export const TAIL_BLOCK = 2

/** C2-B-083: the parts of its tail that a link definition line at `pos` leaves out, as TAIL_TITLE | TAIL_BLOCK. */
export function definitionTailLeft(src: string, pos: number, end: number): number {
  const start = skipSpaceRun(src, labelEnd(src, pos, end, 1, true) + 1, end)
  const p = definitionDestinationEnd(src, start, end)
  const quote = p + 1 < end && src.charCodeAt(p) === SPACE ? src.charCodeAt(p + 1) : 0
  const after = quote === QUOTE_MARK || quote === APOSTROPHE ? quotedEnd(src, p + 1, end, quote) : -1
  const title = after >= 0 && definitionTailEnd(src, after, end) >= 0
  if (definitionTailEnd(src, title ? after : p, end) < end) return 0
  return title ? TAIL_BLOCK : TAIL_TITLE | TAIL_BLOCK
}

/**
 * C2-B-083: when the content of a line below a link definition, from `pos` on, is part of the tail in `left` (a title,
 * an attribute block, or a title, one space and an attribute block, then only spaces and tabs), the parts still left
 * after it; else -1. A title alone leaves the attribute block for the line below.
 */
export function definitionTailLineLeft(src: string, pos: number, end: number, left: number): number {
  const quote = src.charCodeAt(pos)
  if ((left & TAIL_TITLE) !== 0 && (quote === QUOTE_MARK || quote === APOSTROPHE)) {
    const after = quotedEnd(src, pos, end, quote)
    if (after < 0) return -1
    const tail = definitionTailEnd(src, after, end)
    if (tail < 0) return -1
    return tail === end ? left & TAIL_BLOCK : 0
  }
  if ((left & TAIL_BLOCK) === 0 || quote !== BRACE_OPEN) return -1
  const block = readAttributeBlock(src, pos, end, emptyMemo(), null)
  return block >= 0 && skipSpaces(src, block, end) === end ? 0 : -1
}

export function isLinkDefinition(src: string, pos: number, end: number): boolean {
  if (pos + 1 >= end || src.charCodeAt(pos) !== BRACKET_OPEN || src.charCodeAt(pos + 1) === CARET) return false
  const marker = labelEnd(src, pos, end, 1, true)
  if (marker < 0 || marker >= end || src.charCodeAt(marker) !== SPACE) return false
  return definitionDestinationEnd(src, skipSpaceRun(src, marker + 1, end), end) >= 0
}

/** C2-B-083: the spaces between the colon of a definition and its destination; a tab is whitespace of no destination. */
export function skipSpaceRun(src: string, pos: number, end: number): number {
  while (pos < end && src.charCodeAt(pos) === SPACE) pos++
  return pos
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
    if (run === open) return skipSpaces(src, attributeBlocksEnd(src, p, end), end) === end
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
  // C2-B-164: one word of ASCII letters and digits, glued or after one space.
  const name = p + 1 < end && src.charCodeAt(p) === SPACE ? p + 1 : p
  let wordEnd = name
  while (wordEnd < end && isFormatNameCharacter(src.charCodeAt(wordEnd))) wordEnd++
  if (wordEnd > name) p = wordEnd
  return skipSpaces(src, p, end) === end
}

/** A frontmatter opener that names its format: the only one that opens a metadata block after line 1. */
export function isTypedFrontmatterOpener(src: string, pos: number, end: number): boolean {
  if (!isFrontmatterOpener(src, pos, end)) return false
  const name = src.charCodeAt(pos + FRONTMATTER_RUN) === SPACE ? pos + FRONTMATTER_RUN + 1 : pos + FRONTMATTER_RUN
  return name < end && isFormatNameCharacter(src.charCodeAt(name))
}

function isFormatNameCharacter(code: number): boolean {
  return isLower(code) || isUpper(code) || isAsciiDigit(code)
}

/** C2-B-162: exactly `---` plus trailing spaces and tabs. */
export function isFrontmatterCloser(src: string, pos: number, end: number): boolean {
  if (runLength(src, pos, end, HYPHEN) !== FRONTMATTER_RUN) return false
  return skipSpaces(src, pos + FRONTMATTER_RUN, end) === end
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
  return attributeKeyValues(src, pos, end, [key])[0]!
}

/** The values of `keys` on the attribute lines between `pos` and `end`, read in one pass, as `attributeKeyValue` gives each. */
export function attributeKeyValues(src: string, pos: number, end: number, keys: readonly string[]): (string | null)[] {
  const found: (string | null)[] = keys.map(() => null)
  const ignore = (): void => undefined
  const sink: AttributeSink = {
    id: ignore, className: ignore, lang: ignore,
    key: (name, value) => {
      const at = keys.indexOf(name)
      if (at >= 0) found[at] = value
    },
  }
  const memo = emptyMemo()
  let p = pos
  while (p < end) {
    const after = src.charCodeAt(p) === BRACE_OPEN ? readAttributeBlock(src, p, end, memo, sink) : -1
    p = after < 0 ? p + 1 : after
  }
  return found
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
 * The backtick runs of one line, grouped by length, for code-span-aware scans that move forward.
 * Built at the first backtick, so a line without one costs nothing; each length keeps a cursor, so
 * finding every closing run of a forward scan is linear in the line (C2-B-169).
 */
export class BacktickRuns {
  private readonly starts = new Map<number, number[]>()
  private readonly cursors = new Map<number, number>()

  constructor(src: string, pos: number, end: number) {
    let p = pos
    while (p < end) {
      if (src.charCodeAt(p) !== BACKTICK) {
        p++
        continue
      }
      const run = runLength(src, p, end, BACKTICK)
      const list = this.starts.get(run)
      if (list === undefined) this.starts.set(run, [p])
      else list.push(p)
      p += run
    }
  }

  /** Start of the first run of exactly `length` at or after `pos`, or -1. Calls for one length move forward. */
  closer(pos: number, length: number): number {
    const list = this.starts.get(length)
    if (list === undefined) return -1
    let index = this.cursors.get(length) ?? 0
    while (index < list.length && list[index]! < pos) index++
    this.cursors.set(length, index)
    return index < list.length ? list[index]! : -1
  }
}

/**
 * Offset of the first `target` character between `pos` and `end` that is neither escaped nor
 * between a backtick run and its matching closing run, or -1. With `first` false the scan goes on
 * to the last such offset, and `out` collects every one of them.
 */
function scanOutsideCode(src: string, pos: number, end: number, target: number, first: boolean, out: number[] | null): number {
  let runs: BacktickRuns | null = null
  let last = -1
  let p = pos
  while (p < end) {
    const code = src.charCodeAt(p)
    if (code === target) {
      if (first) return p
      out?.push(p)
      last = p
      p++
    } else if (code === BACKSLASH) {
      p += 2
    } else if (code === BACKTICK) {
      const run = runLength(src, p, end, BACKTICK)
      runs ??= new BacktickRuns(src, p + run, end)
      const close = runs.closer(p + run, run)
      p = close < 0 ? p + run : close + run
    } else {
      p++
    }
  }
  return last
}

/**
 * The pipes that separate cells between `pos` and `end`, in order (C2-B-169). A pipe is no
 * separator when it is escaped or stands between a backtick run and its matching closing run.
 */
export function separatorPipes(src: string, pos: number, end: number): number[] {
  const pipes: number[] = []
  scanOutsideCode(src, pos, end, PIPE, false, pipes)
  return pipes
}

/** Offset of the last separating pipe between `pos` and `end`, or -1. */
function lastPipe(src: string, pos: number, end: number): number {
  return scanOutsideCode(src, pos, end, PIPE, false, null)
}

/** Offset of the brace block of the row attribute behind the closing pipe at `pipe`, or -1 (C2-B-167). */
export function rowAttributeStart(src: string, pipe: number, end: number, scans?: Map<number, number>): number {
  let p = pipe + 1
  if (p < end && src.charCodeAt(p) === SPACE) p++
  const blockEnd = braceBlockEnd(src, p, end, scans)
  return blockEnd < 0 || readAttributeBlock(src, p, blockEnd, emptyMemo(), null) !== blockEnd ? -1 : p
}

function rowTailValid(src: string, pipe: number, end: number): boolean {
  const attribute = rowAttributeStart(src, pipe, end)
  const behind = attribute < 0 ? pipe + 1 : attributeBlocksEnd(src, attribute, end)
  const tail = skipSpaces(src, behind, end)
  if (tail === end) return true
  // C2-B-133: a line comment stands after whitespace; `%%` glued to the pipe or to the row attribute is text.
  if (tail === behind) return false
  // C2-B-166: the closing pipe is the last pipe of the line, so a pipe in the comment ends no row; the search stops at the line end.
  const later = src.indexOf('|', tail)
  return isInnerLineComment(src, tail, end) && (later < 0 || later >= end)
}

/**
 * Offset of the closing pipe of the table row at `pos`, or -1 (C2-B-166). The row starts with a
 * pipe and ends with another; a row attribute and a line comment may follow the last pipe (C2-B-167).
 */
export function rowClosingPipe(src: string, pos: number, end: number): number {
  if (src.charCodeAt(pos) !== PIPE) return -1
  const last = lastPipe(src, pos + 1, end)
  if (last < 0) return -1
  // C2-B-166: the closing pipe is the last pipe of the line, so an escaped pipe in a row attribute's value ends no row.
  if (rowTailValid(src, last, end)) return src.indexOf('|', last + 1) < 0 || src.indexOf('|', last + 1) >= end ? last : -1
  return quotedPipeRowEnd(src, pos + 1, last, end)
}

/** C2-B-166: the pipe before a row attribute whose quoted values hold the later pipes of the line, or -1. */
function quotedPipeRowEnd(src: string, from: number, last: number, end: number): number {
  // A line of `|{` without a `}` scanned to its end from every pipe.
  const scans = new Map<number, number>()
  for (let p = src.indexOf('|', from); p >= 0 && p < last; p = src.indexOf('|', p + 1)) {
    if (rowAttributeStart(src, p, end, scans) >= 0 && rowTailValid(src, p, end)) return p
  }
  return -1
}

/** Offset of the closing pipe of the continuation row at `pos`, or -1 (C2-B-175, C2-B-170). */
export function continuationClosingPipe(src: string, pos: number, end: number): number {
  if (src.charCodeAt(pos) !== PLUS) return -1
  const last = lastPipe(src, pos + 1, end)
  return last >= 0 && skipSpaces(src, last + 1, end) === end ? last : -1
}

/** Offset of the first bare `#` of a caption's text, the caption number mark, or -1 (C2-B-207). */
export function captionNumberMark(src: string, pos: number, end: number): number {
  return scanOutsideCode(src, pos, end, HASH, true, null)
}

/** Offset after the last character between `pos` and `end` that is not a space or a tab. */
export function trimEnd(src: string, pos: number, end: number): number {
  while (end > pos && isSpaceOrTab(src.charCodeAt(end - 1))) end--
  return end
}
