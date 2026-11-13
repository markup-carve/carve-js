// Line-shape tests shared by both variants. Each one reads char codes of the
// source between `pos` and `end` (the end of the line) and copies nothing.

export const TAB = 9
export const LF = 10
export const CR = 13
export const SPACE = 32
export const HASH = 35
export const STAR = 42
export const HYPHEN = 45
export const DOT = 46
export const DIGIT_0 = 48
export const DIGIT_9 = 57
export const EQUALS = 61
export const GREATER = 62
export const BACKTICK = 96

const MAX_HEADING_LEVEL = 6
const MAX_ORDERED_DIGITS = 9
const MIN_FENCE_LENGTH = 3

export function isSpaceOrTab(code: number): boolean {
  return code === SPACE || code === TAB
}

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

/** Offset after a quote mark (`>` then a space or the line end), or -1. */
export function quoteMarkEnd(src: string, pos: number, end: number): number {
  const next = pos + 1
  if (next >= end) return end
  return src.charCodeAt(next) === SPACE ? next + 1 : -1
}

/** Offset of the content after a marker that ends at `markerEnd`, or -1: a marker needs a space and content. */
function contentAfterMarker(src: string, markerEnd: number, end: number): number {
  if (markerEnd >= end || src.charCodeAt(markerEnd) !== SPACE) return -1
  const content = skipSpaces(src, markerEnd + 1, end)
  return content < end ? content : -1
}

/** Content offset of a bullet item whose `-` or `*` is at `pos`, or -1. */
export function bulletContentStart(src: string, pos: number, end: number): number {
  return contentAfterMarker(src, pos + 1, end)
}

/** Content offset of an ordered item whose first digit is at `pos`, or -1. */
export function orderedContentStart(src: string, pos: number, end: number): number {
  let p = pos + 1
  while (p < end) {
    const code = src.charCodeAt(p)
    if (code < DIGIT_0 || code > DIGIT_9) break
    p++
  }
  if (p - pos > MAX_ORDERED_DIGITS || p >= end || src.charCodeAt(p) !== DOT) return -1
  return contentAfterMarker(src, p + 1, end)
}

/** Content offset of the list item that starts at `pos`, or -1 when the line is no item. */
export function listContentStart(src: string, pos: number, end: number): number {
  const code = src.charCodeAt(pos)
  if (code === HYPHEN || code === STAR) return bulletContentStart(src, pos, end)
  if (code >= DIGIT_0 && code <= DIGIT_9) return orderedContentStart(src, pos, end)
  return -1
}

/** Value of the digit run at `pos`. */
export function decimalAt(src: string, pos: number): number {
  let value = 0
  for (;;) {
    const code = src.charCodeAt(pos++)
    if (!(code >= DIGIT_0 && code <= DIGIT_9)) return value
    value = value * 10 + (code - DIGIT_0)
  }
}

/** Heading level of the `=` or `#` run at `pos`, or 0: the run needs a space and text after it. */
export function headingLevel(src: string, pos: number, end: number): number {
  const level = runLength(src, pos, end, src.charCodeAt(pos))
  if (level > MAX_HEADING_LEVEL) return 0
  return contentAfterMarker(src, pos + level, end) < 0 ? 0 : level
}

/** Length of the backtick run at `pos` when it opens a fence, or 0. */
export function fenceOpenerLength(src: string, pos: number, end: number): number {
  const length = runLength(src, pos, end, BACKTICK)
  return length >= MIN_FENCE_LENGTH ? length : 0
}

/** A closer is a bare backtick run at least as long as the opener. */
export function isFenceCloser(src: string, pos: number, end: number, openerLength: number): boolean {
  if (src.charCodeAt(pos) !== BACKTICK) return false
  const length = runLength(src, pos, end, BACKTICK)
  return length >= openerLength && skipSpaces(src, pos + length, end) === end
}
