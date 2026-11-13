// Line geometry for the source-layout record (spec/0.2/source-layout.md): line bounds, the columns
// of the block chapter, blank-line counts and UTF-8 byte offsets.
import { CR, GREATER, SPACE } from './chars.ts'
import { skipSpaces } from './lines.ts'
import { unitBytes } from './positions.ts'
import { advanceColumn, isSpaceOrTab } from './source.ts'

const LOW_SURROGATE = 0xdc00
const LOW_SURROGATE_END = 0xdfff

/** The offset of the first character of the line that holds `pos`. */
export function lineStartOf(src: string, pos: number): number {
  return pos <= 0 ? 0 : src.lastIndexOf('\n', pos - 1) + 1
}

/** The offset behind the last character of the line that holds `pos`, before its line ending. */
export function lineEndOf(src: string, pos: number): number {
  const feed = src.indexOf('\n', pos)
  const end = feed < 0 ? src.length : feed
  return end > pos && src.charCodeAt(end - 1) === CR ? end - 1 : end
}

/** Where a line stands behind its quote marks: the offset, the column from the start of the line and the column that counts as 0. */
interface Prefix {
  pos: number
  column: number
  origin: number
  marks: number
}

/** C2-B-003: reads at most `quotes` quote marks from `start`, each with its one space. */
export function readPrefix(src: string, start: number, end: number, quotes: number): Prefix {
  const prefix: Prefix = { pos: start, column: 0, origin: 0, marks: 0 }
  while (prefix.marks < quotes) {
    let pos = prefix.pos
    let column = prefix.column
    while (pos < end && isSpaceOrTab(src.charCodeAt(pos))) column = advanceColumn(column, src.charCodeAt(pos++))
    if (pos >= end || src.charCodeAt(pos) !== GREATER) break
    pos++
    column++
    if (pos < end && src.charCodeAt(pos) === SPACE) {
      pos++
      column++
    }
    prefix.pos = pos
    prefix.column = column
    prefix.origin = column
    prefix.marks++
  }
  return prefix
}

/** C2-B-003 to C2-B-005: the zero-based column of `offset` inside `quotes` open quotes. Tab stops count from the start of the line. */
export function columnOf(src: string, offset: number, quotes: number): number {
  const prefix = readPrefix(src, lineStartOf(src, offset), offset, quotes)
  let column = prefix.column
  for (let pos = prefix.pos; pos < offset; pos++) {
    const code = src.charCodeAt(pos)
    // Columns count code points, so the second half of a pair adds none.
    if (code < LOW_SURROGATE || code > LOW_SURROGATE_END) column = advanceColumn(column, code)
  }
  return column - prefix.origin
}

/** True when the line `[start, end)` carries exactly `quotes` quote marks and nothing else but spaces and tabs. */
function isBlankInside(src: string, start: number, end: number, quotes: number): boolean {
  const prefix = readPrefix(src, start, end, quotes)
  return prefix.marks === quotes && skipSpaces(src, prefix.pos, end) >= end
}

/** C2-L-026: the blank lines directly above the line of `start`, down to the first line of the container that starts at `floor`. */
export function blankLinesBefore(src: string, start: number, floor: number, quotes: number): number {
  const first = lineStartOf(src, floor)
  let line = lineStartOf(src, start)
  let count = 0
  while (line > first) {
    const previous = lineStartOf(src, line - 1)
    if (!isBlankInside(src, previous, lineEndOf(src, previous), quotes)) break
    count++
    line = previous
  }
  return count
}

/**
 * C2-L-026: the blank lines directly below the line of `end`. They stop at `limit`, the end of the
 * container, unless the container is `open`: a quote ends at its last content, and the blank
 * lines that carry its mark are still inside it.
 */
export function blankLinesAfter(src: string, end: number, limit: number, quotes: number, open: boolean): number {
  let count = 0
  let feed = src.indexOf('\n', end)
  while (feed >= 0 && feed + 1 < src.length) {
    const start = feed + 1
    if (!open && start >= limit) break
    if (!isBlankInside(src, start, lineEndOf(src, start), quotes)) break
    count++
    feed = src.indexOf('\n', start)
  }
  return count
}

/** C2-L-012: the UTF-8 byte offset of every string offset of `src`. */
export function byteOffsets(src: string): (offset: number) => number {
  let ascii = true
  for (let at = 0; at < src.length && ascii; at++) ascii = src.charCodeAt(at) < 0x80
  if (ascii) return (offset) => offset
  const table = new Int32Array(src.length + 1)
  let bytes = 0
  for (let at = 0; at < src.length; at++) {
    table[at] = bytes
    bytes += unitBytes(src.charCodeAt(at))
  }
  table[src.length] = bytes
  return (offset) => table[offset]!
}
