// The continuation rows of a pipe table for the source-layout record (C2-L-019 to C2-L-021): how
// many each row has, and where each fragment starts in the content of its cell.
import { type AstNode, rowspanOf } from './ast.ts'
import { type LayoutTrace } from './ast-inline.ts'
import { GREATER, PLUS } from './chars.ts'
import { ROW } from './kinds.ts'
import type { Wrap } from './layout.ts'
import { lineEndOf } from './layout-lines.ts'
import { skipSpaces } from './lines.ts'
import { utf8Length } from './positions.ts'
import { isSpaceOrTab } from './source.ts'
import { type BlockNode } from './tree.ts'

/** The rows of one table in source order, with the ranges of the continuation rows of each, read on demand. */
export interface TableRows {
  rows: BlockNode[]
  index: Map<BlockNode, number>
  continuations: (number[] | undefined)[]
}

export function tableRows(table: BlockNode): TableRows {
  const rows = table.children!.filter((child) => child.kind === ROW)
  const index = new Map<BlockNode, number>()
  rows.forEach((row, at) => index.set(row, at))
  return { rows, index, continuations: [] }
}

/** C2-B-175: the start and the end of each continuation row of row `at`. A comment-only line between them is none. */
export function continuationRows(src: string, table: TableRows, at: number): number[] {
  const known = table.continuations[at]
  if (known !== undefined) return known
  const row = table.rows[at]!
  const found: number[] = []
  for (let feed = src.indexOf('\n', row.start); feed >= 0 && feed < row.end; feed = src.indexOf('\n', feed + 1)) {
    let pos = feed + 1
    while (pos < row.end && (isSpaceOrTab(src.charCodeAt(pos)) || src.charCodeAt(pos) === GREATER)) pos++
    if (src.charCodeAt(pos) === PLUS) found.push(pos, lineEndOf(src, pos))
  }
  table.continuations[at] = found
  return found
}

/** The first and the last source offset of the pieces of a cell, between the pipes around them (C2-L-013). */
export function cellRange(src: string, table: TableRows, row: number, cell: BlockNode): [number, number] {
  const spans = cell.spans!
  // A cell that a continuation row formed starts behind its pipe; any other starts at it (C2-B-176).
  const formed = cell.start >= lineEndOf(src, table.rows[row]!.start)
  const last = spans.length === 0 ? cell.end : spans[spans.length - 1]!
  return [formed ? cell.start : cell.start + 1, Math.max(cell.end, skipSpaces(src, last, lineEndOf(src, last)))]
}

/** A walk over the content of one cell in source order. The fragments it meets only move forward. */
interface CellWalk {
  src: string
  trace: LayoutTrace
  table: TableRows
  home: number
  spanning: boolean
  spans: number[]
  spanAt: number
  row: number
  line: number
  wraps: Wrap[]
}

/** Adds the wrap of the fragment that starts at the source offset `fragment`. */
function addWrap(walk: CellWalk, fragment: number, path: string, offset: number): void {
  const rows = walk.table.rows
  let row = walk.row
  while (row < rows.length && rows[row]!.end < fragment) row++
  if (row >= rows.length || rows[row]!.start > fragment) return
  if (row !== walk.row) walk.line = 0
  walk.row = row
  const lines = continuationRows(walk.src, walk.table, row)
  while (walk.line < lines.length && lines[walk.line + 1]! < fragment) walk.line += 2
  if (walk.line >= lines.length || lines[walk.line]! > fragment) return
  const wrap: Wrap = { line: walk.line / 2 + 1, path, offset }
  // C2-L-020: the rows below the cell's own row.
  if (walk.spanning) wrap.row = row - walk.home
  walk.wraps.push(wrap)
}

/** C2-L-021: a joining space is the character before the offset, which counts UTF-8 bytes of the value. */
function textWraps(walk: CellWalk, node: AstNode, path: string, breaks: number[]): void {
  const value = node.value!
  let from = 0
  let bytes = 0
  for (let at = 0; at < breaks.length; at += 2) {
    bytes += utf8Length(value.slice(from, breaks[at]))
    from = breaks[at]!
    addWrap(walk, breaks[at + 1]!, path, bytes)
  }
}

/** A node with a value that crosses lines, a code span for one, holds each break as a line feed. */
function valueWraps(walk: CellWalk, node: AstNode, path: string, start: number, end: number): void {
  const value = node.value!
  const spans = walk.spans
  while (walk.spanAt < spans.length && spans[walk.spanAt]! <= start) walk.spanAt += 2
  let feed = -1
  let bytes = 0
  for (; walk.spanAt < spans.length && spans[walk.spanAt]! < end; walk.spanAt += 2) {
    const next = value.indexOf('\n', feed + 1)
    if (next < 0) return
    bytes += utf8Length(value.slice(feed + 1, next + 1))
    feed = next
    addWrap(walk, spans[walk.spanAt]!, path, bytes)
  }
}

/** True when a piece of the cell starts at the source offset `offset`. */
function startsPiece(walk: CellWalk, offset: number): boolean {
  const spans = walk.spans
  while (walk.spanAt < spans.length && spans[walk.spanAt]! < offset) walk.spanAt += 2
  return walk.spanAt < spans.length && spans[walk.spanAt] === offset
}

function walkList(walk: CellWalk, nodes: AstNode[], base: string): void {
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    const path = `${base}/${at}`
    const breaks = walk.trace.breaks.get(node)
    const origin = walk.trace.inlines.get(node)
    if (breaks !== undefined) {
      textWraps(walk, node, path, breaks)
    } else if (origin === undefined) {
      continue
    } else if (node.type === 'hard_break') {
      // A hard break leaves no joining space: the fragment starts at offset 0 of the node behind it.
      if (at + 1 < nodes.length && startsPiece(walk, origin.end)) addWrap(walk, origin.end, `${base}/${at + 1}`, 0)
    } else if (node.children !== undefined) {
      walkList(walk, node.children, `${path}/children`)
    } else if (typeof node.value === 'string') {
      valueWraps(walk, node, path, origin.start, origin.end)
    }
  }
}

/** C2-L-020: the wraps of the cell at `path`, whose own row is row `home` of `table`. */
export function cellWraps(src: string, trace: LayoutTrace, table: TableRows, home: number, node: AstNode, cell: BlockNode, path: string): Wrap[] {
  const walk: CellWalk = {
    src, trace, table, home, spanning: (rowspanOf(node)) > 1, spans: cell.spans!, spanAt: 2, row: home, line: 0, wraps: [],
  }
  const content = node.children![0]?.children ?? []
  const base = `${path}/children/0/children`
  // C2-L-021: a cell whose first piece stands in a continuation row starts with that fragment, at offset 0.
  if (content.length > 0 && cell.spans!.length > 0 && cell.spans![0]! >= lineEndOf(src, table.rows[home]!.start)) {
    addWrap(walk, cell.spans![0]!, `${base}/0`, 0)
  }
  walkList(walk, content, base)
  // The clause sorts by line alone; the walk gives them by row, then line.
  if (walk.spanning) walk.wraps.sort((a, b) => a.line - b.line)
  return walk.wraps
}
