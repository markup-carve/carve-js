// Positions of the public tree (C2-A-140, C2-A-141). Both passes work on string offsets; the tree
// builder stores those, and this file turns them into lines, columns and UTF-8 byte offsets in
// one walk over the finished tree.
import { type AstNode, type Position } from './ast.ts'
import { LF } from './chars.ts'

const ASCII_END = 0x80
const TWO_BYTES_END = 0x800
const HIGH_SURROGATE = 0xd800
const LOW_SURROGATE_END = 0xdfff
const HIGH_SURROGATE_END = 0xdbff

/** Bytes of the UTF-16 code unit `code` in UTF-8. A surrogate pair is four bytes, counted as two per half. */
function unitBytes(code: number): number {
  if (code < ASCII_END) return 1
  if (code < TWO_BYTES_END) return 2
  return code >= HIGH_SURROGATE && code <= LOW_SURROGATE_END ? 2 : 3
}

/** The number of UTF-8 bytes of `src` (C2-A-010). */
export function utf8Length(src: string): number {
  let bytes = 0
  for (let at = 0; at < src.length; at++) bytes += unitBytes(src.charCodeAt(at))
  return bytes
}

/**
 * The string offset of the UTF-8 byte offset `byte` of `src`, for a caller that holds a position
 * of the tree and an editor that counts in string offsets. An offset inside a character gives
 * the offset of that character.
 */
export function stringOffsetOfByte(src: string, byte: number): number {
  let bytes = 0
  for (let at = 0; at < src.length; at++) {
    const next = bytes + unitBytes(src.charCodeAt(at))
    if (next > byte) return at
    bytes = next
  }
  return src.length
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
    bytes += unitBytes(code)
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
  while (cursor.offset < target) {
    const code = src.charCodeAt(cursor.offset)
    cursor.bytes += unitBytes(code)
    // C2-A-141: columns count code points, so the second half of a pair adds none.
    if (code < HIGH_SURROGATE || code > HIGH_SURROGATE_END) cursor.column++
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

/** The slots that hold positioned nodes besides `children`, in source order where there is one. */
function slotNodes(node: AstNode): AstNode[] {
  const nodes: AstNode[] = []
  if (Array.isArray(node.title)) nodes.push(...node.title)
  if (node.children !== undefined) nodes.push(...node.children)
  if (node.caption !== undefined) nodes.push(node.caption)
  return nodes
}

function placeNode(cursor: Cursor, node: AstNode): void {
  const pos = node.pos
  const end = pos === undefined ? 0 : pos.endOffset
  if (pos !== undefined) placeStart(cursor, pos)
  for (const child of slotNodes(node)) placeNode(cursor, child)
  if (pos !== undefined) placeEnd(cursor, pos, end)
}

/** Replaces the string offsets the tree builder stored in every `pos` by the six integers of C2-A-140. */
export function finishPositions(root: AstNode, src: string): void {
  placeNode({ src, table: lineTable(src), line: 0, offset: 0, bytes: 0, column: 1 }, root)
}
