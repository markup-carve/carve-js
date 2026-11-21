// Positions of the public tree (C2-A-140, C2-A-141). Both passes work on string offsets; the tree
// builder stores those, and this file turns them into lines, columns and UTF-8 byte offsets in
// one walk over the finished tree.
import { type Node, type NodeSlots, type Position, titleOf } from './ast.ts'
import { BYTE_ORDER_MARK, LF } from './chars.ts'
import { CarveOptionError } from './options.ts'

const ASCII_END = 0x80
const TWO_BYTES_END = 0x800
const HIGH_SURROGATE = 0xd800
const LOW_SURROGATE_END = 0xdfff
const HIGH_SURROGATE_END = 0xdbff
const LOW_SURROGATE = 0xdc00

/** Whether the code units at `at` and `at + 1` of `text` are the two halves of one character. */
function isPairAt(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  // Written so that NaN, the code of an offset outside the text, is no half either.
  if (!(code >= HIGH_SURROGATE && code <= HIGH_SURROGATE_END)) return false
  const next = text.charCodeAt(at + 1)
  return next >= LOW_SURROGATE && next <= LOW_SURROGATE_END
}

/** Whether the code unit at `at` of `text` is the second half of a surrogate pair, so no character starts there. */
export function isSecondHalf(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  return code >= LOW_SURROGATE && code <= LOW_SURROGATE_END && isPairAt(text, at - 1)
}

/**
 * Bytes in UTF-8 of the code unit at `at` of `text`. A surrogate pair is four bytes, counted as two per half;
 * an unpaired surrogate is encoded as U+FFFD, three bytes, as UTF-8 encoders do.
 */
export function unitBytes(text: string, at: number): number {
  const code = text.charCodeAt(at)
  if (code < ASCII_END) return 1
  if (code < TWO_BYTES_END) return 2
  if (code < HIGH_SURROGATE || code > LOW_SURROGATE_END) return 3
  return isPairAt(text, at) || isSecondHalf(text, at) ? 2 : 3
}

/** The number of UTF-8 bytes of `src` (C2-A-010). */
export function utf8Length(src: string): number {
  let bytes = 0
  for (let at = 0; at < src.length; at++) bytes += unitBytes(src, at)
  return bytes
}

/**
 * The string offset of the UTF-8 byte offset `byte` of `src`, for a caller that holds a position
 * of the tree and an editor that counts in string offsets. An offset inside a character gives
 * the offset of that character, never the second half of a surrogate pair.
 */
export function stringOffsetOfByte(src: string, byte: number): number {
  let bytes = 0
  for (let at = 0; at < src.length;) {
    const units = isPairAt(src, at) ? 2 : 1
    const next = bytes + (units === 2 ? 4 : unitBytes(src, at))
    if (next > byte) return at
    bytes = next
    at += units
  }
  return src.length
}

/** `stringOffsetOfByte` for many offsets into one source, each walking only from the one before. */
export class ByteCursor {
  private at = 0
  private bytes = 0
  readonly src: string

  constructor(src: string) {
    this.src = src
  }

  stringOffset(byte: number): number {
    const src = this.src
    while (this.bytes > byte) {
      this.at -= this.at >= 2 && isPairAt(src, this.at - 2) ? 2 : 1
      this.bytes -= isPairAt(src, this.at) ? 4 : unitBytes(src, this.at)
    }
    while (this.at < src.length) {
      const units = isPairAt(src, this.at) ? 2 : 1
      const next = this.bytes + (units === 2 ? 4 : unitBytes(src, this.at))
      if (next > byte) break
      this.bytes = next
      this.at += units
    }
    return this.at
  }

  /** The byte offset of the string offset `at`, which lies at or after `stringOffset(byte)` of the last call. */
  byteOffset(at: number): number {
    let bytes = this.bytes
    for (let unit = this.at; unit < at; unit++) bytes += unitBytes(this.src, unit)
    return bytes
  }
}

/** The start of every line as a string offset and as a byte offset, and whether the line is ASCII. */
interface LineTable {
  starts: number[]
  bytes: number[]
  ascii: boolean[]
}

function lineTable(src: string): LineTable {
  const table: LineTable = { starts: [0], bytes: [0], ascii: [] }
  let bytes = 0
  let ascii = true
  for (let at = 0; at < src.length; at++) {
    const code = src.charCodeAt(at)
    bytes += unitBytes(src, at)
    if (code >= ASCII_END) ascii = false
    if (code !== LF) continue
    table.ascii.push(ascii)
    table.starts.push(at + 1)
    table.bytes.push(bytes)
    ascii = true
  }
  table.ascii.push(ascii)
  return table
}

/** A place in the source that only moves forward inside one line, so a tree is placed in one pass. */
interface Cursor {
  src: string
  table: LineTable
  line: number
  offset: number
  bytes: number
  column: number
}

function lineOf(starts: number[], offset: number): number {
  let low = 0
  let high = starts.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (starts[middle]! <= offset) low = middle
    else high = middle - 1
  }
  return low
}

/** Moves the cursor to the string offset `target`. */
function seek(cursor: Cursor, target: number): void {
  const table = cursor.table
  const nextStart = cursor.line + 1 < table.starts.length ? table.starts[cursor.line + 1]! : Infinity
  if (target < cursor.offset || target >= nextStart) {
    cursor.line = lineOf(table.starts, target)
    cursor.offset = table.starts[cursor.line]!
    cursor.bytes = table.bytes[cursor.line]!
    cursor.column = 1
  }
  if (table.ascii[cursor.line]!) {
    cursor.bytes += target - cursor.offset
    cursor.column += target - cursor.offset
    cursor.offset = target
    return
  }
  const src = cursor.src
  // C2-B-165: a byte-order mark takes no column; its bytes still count.
  if (cursor.offset === 0 && target > 0 && src.charCodeAt(0) === BYTE_ORDER_MARK) {
    cursor.bytes += unitBytes(src, 0)
    cursor.offset = 1
  }
  while (cursor.offset < target) {
    cursor.bytes += unitBytes(src, cursor.offset)
    // C2-A-141: columns count code points, so the first half of a pair adds none; an unpaired half is one.
    if (!isPairAt(src, cursor.offset)) cursor.column++
    cursor.offset++
  }
}

function placeStart(cursor: Cursor, pos: Position): void {
  seek(cursor, pos.startOffset)
  pos.startLine = cursor.line + 1
  pos.startColumn = cursor.column
  pos.startOffset = cursor.bytes
}

function placeEnd(cursor: Cursor, pos: Position, end: number): void {
  seek(cursor, end)
  pos.endLine = cursor.line + 1
  pos.endColumn = cursor.column
  pos.endOffset = cursor.bytes
}

/** Places a node, then the slots that hold positioned nodes in source order, then its end. */
function placeNode(cursor: Cursor, node: Node): void {
  const slots: NodeSlots = node
  const pos = node.pos
  const end = pos === undefined ? 0 : pos.endOffset
  if (pos !== undefined) placeStart(cursor, pos)
  const title = titleOf(slots)
  if (title !== undefined) for (const child of title) placeNode(cursor, child)
  if (slots.children !== undefined) for (const child of slots.children) placeNode(cursor, child)
  if (slots.caption !== undefined) placeNode(cursor, slots.caption)
  if (pos !== undefined) placeEnd(cursor, pos, end)
}

/** Replaces the string offsets the tree builder stored in every `pos` by the six integers of C2-A-140. */
export function finishPositions(root: Node, src: string): void {
  placeNode({ src, table: lineTable(src), line: 0, offset: 0, bytes: 0, column: 1 }, root)
}

/** The second byte range a lead byte allows, and the length of its sequence (WHATWG UTF-8 decode). */
function leadRule(lead: number): [number, number, number] | null {
  if (lead >= 0xc2 && lead <= 0xdf) return [0x80, 0xbf, 2]
  if (lead === 0xe0) return [0xa0, 0xbf, 3]
  if (lead === 0xed) return [0x80, 0x9f, 3]
  if (lead >= 0xe1 && lead <= 0xef) return [0x80, 0xbf, 3]
  if (lead === 0xf0) return [0x90, 0xbf, 4]
  if (lead >= 0xf1 && lead <= 0xf3) return [0x80, 0xbf, 4]
  if (lead === 0xf4) return [0x80, 0x8f, 4]
  return null
}

/** The byte length of the code point at `at`, or of the ill-formed sequence one U+FFFD replaces there (C2-B-218). */
function unitLength(bytes: Uint8Array, at: number): number {
  const lead = bytes[at]!
  if (lead < ASCII_END) return 1
  const rule = leadRule(lead)
  if (rule === null) return 1
  let length = 1
  for (let low = rule[0], high = rule[1]; length < rule[2]; length++, low = 0x80, high = 0xbf) {
    const next = bytes[at + length]
    if (next === undefined || next < low || next > high) break
  }
  return length
}

/**
 * C2-T-041: the line and column of C2-T-019 for a range that starts at the UTF-8 byte offset `offset` of `source`.
 * An offset outside the source or inside one code point, or one replaced ill-formed sequence, is refused.
 */
export function positionOf(source: string | Uint8Array, offset: number): { line: number, column: number } {
  if (typeof source !== 'string' && !(source instanceof Uint8Array)) throw new CarveOptionError('source', 'not text or bytes')
  const bytes = typeof source === 'string' ? new TextEncoder().encode(source) : source
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > bytes.length) {
    throw new CarveOptionError('offset', `${String(offset)} is no offset into ${bytes.length} bytes`)
  }
  let line = 1
  let column = 1
  let at = 0
  while (at < offset) {
    if (bytes[at] === LF) {
      line++
      column = 1
    } else column++
    at += unitLength(bytes, at)
  }
  if (at !== offset) throw new CarveOptionError('offset', `${offset} is inside the bytes of one code point`)
  return { line, column }
}
