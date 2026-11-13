// Line-shape tests. Each reads character codes of the source between `pos` and `end`
// (the end of the line) and copies nothing.
import {
  BACKTICK, BANG, BRACKET_CLOSE, BRACKET_OPEN, DIGIT_0, DIGIT_9, DOT, EQUALS, GREATER, HASH, HYPHEN,
  LOWER_X, PAREN_CLOSE, PERCENT, QUESTION, SLASH, SPACE, STAR, TILDE, UNDERSCORE, UPPER_X,
} from './chars.ts'
import { isSpaceOrTab } from './source.ts'

const MAX_HEADING_LEVEL = 6
const MAX_ORDERED_DIGITS = 9
const MIN_FENCE_LENGTH = 3
const MIN_BREAK_LENGTH = 3
const TASK_BOX_LENGTH = 4

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

/** C2-B-028: `>` followed by a space or by the end of the line. */
export function isQuoteMark(src: string, pos: number, end: number): boolean {
  if (pos >= end || src.charCodeAt(pos) !== GREATER) return false
  return pos + 1 === end || src.charCodeAt(pos + 1) === SPACE
}

/** Offset after the space of a marker that ends at `markerEnd`, or -1 (C2-B-006, C2-B-030). */
function afterMarkerSpace(src: string, markerEnd: number, end: number): number {
  if (markerEnd >= end || src.charCodeAt(markerEnd) !== SPACE) return -1
  return skipSpaces(src, markerEnd + 1, end) < end ? markerEnd + 1 : -1
}

/** Offset after the space of the bullet marker at `pos`, or -1 (C2-B-031). */
export function bulletMarkerEnd(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code !== HYPHEN && code !== STAR) return -1
  return afterMarkerSpace(src, pos + 1, end)
}

/** Offset after the space of the ordered marker at `pos`, or -1. The delimiter stands two before it (C2-B-033). */
export function orderedMarkerEnd(src: string, pos: number, end: number): number {
  let p = pos
  while (p < end) {
    const code = src.charCodeAt(p)
    if (code < DIGIT_0 || code > DIGIT_9) break
    p++
  }
  if (p - pos > MAX_ORDERED_DIGITS || p >= end) return -1
  const delimiter = src.charCodeAt(p)
  if (delimiter !== DOT && delimiter !== PAREN_CLOSE) return -1
  return afterMarkerSpace(src, p + 1, end)
}

/** True when a list marker with content stands at `pos`. */
export function isListMarker(src: string, pos: number, end: number): boolean {
  return bulletMarkerEnd(src, pos, end) >= 0 || orderedMarkerEnd(src, pos, end) >= 0
}

/** Value of the digits between `pos` and `end`, or -1 when there are none. */
export function decimalValue(src: string, pos: number, end: number): number {
  if (pos >= end) return -1
  let value = 0
  for (let p = pos; p < end; p++) value = value * 10 + (src.charCodeAt(p) - DIGIT_0)
  return value
}

function isTaskState(code: number): boolean {
  return code === SPACE || code === LOWER_X || code === UPPER_X || code === UNDERSCORE || code === SLASH ||
    code === BANG || code === HYPHEN || code === GREATER || code === QUESTION
}

/** Offset after the space of the task box at `pos`, or -1 (C2-B-039). */
export function taskBoxEnd(src: string, pos: number, end: number): number {
  if (pos + TASK_BOX_LENGTH > end) return -1
  if (src.charCodeAt(pos) !== BRACKET_OPEN || src.charCodeAt(pos + 2) !== BRACKET_CLOSE) return -1
  if (!isTaskState(src.charCodeAt(pos + 1))) return -1
  return afterMarkerSpace(src, pos + 3, end)
}

/** Heading level of the `=` or `#` run at `pos`, or 0 (C2-B-104, C2-B-105). */
export function headingLevel(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code !== EQUALS && code !== HASH) return 0
  const level = runLength(src, pos, end, code)
  if (level > MAX_HEADING_LEVEL) return 0
  return afterMarkerSpace(src, pos + level, end) < 0 ? 0 : level
}

/** Length of the backtick or tilde run at `pos` when it opens a code fence, or 0 (C2-B-080). */
export function fenceOpenerLength(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code !== BACKTICK && code !== TILDE) return 0
  const length = runLength(src, pos, end, code)
  if (length < MIN_FENCE_LENGTH) return 0
  if (code === BACKTICK) {
    // C2-B-086: a backtick in the info string makes the run inline code.
    for (let p = pos + length; p < end; p++) if (src.charCodeAt(p) === BACKTICK) return 0
  }
  return length
}

/** C2-B-081, C2-B-082: a bare run of the opener's character, at least as long as the opener. */
export function isFenceCloser(src: string, pos: number, end: number, code: number, openerLength: number): boolean {
  const length = runLength(src, pos, end, code)
  return length >= openerLength && skipSpaces(src, pos + length, end) === end
}

/** C2-B-110: three or more stars and nothing else. */
export function isThematicBreak(src: string, pos: number, end: number): boolean {
  const length = runLength(src, pos, end, STAR)
  return length >= MIN_BREAK_LENGTH && skipSpaces(src, pos + length, end) === end
}

/** True when a line comment starts at `pos`. Three percent signs open a comment block instead (C2-B-080). */
export function isLineComment(src: string, pos: number, end: number): boolean {
  return runLength(src, pos, end, PERCENT) === 2
}
