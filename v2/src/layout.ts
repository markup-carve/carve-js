// The source-layout record of spec/0.2/source-layout.md: how the author spelled the document, in a
// second object beside the tree. It is built from what the tree builder traced, and only on request (C2-L-001).
import { type AstNode } from './ast.ts'
import { BYTE_ORDER_MARK, CR, LF } from './chars.ts'
import { CELL, QUOTE, ROW, TABLE } from './kinds.ts'
import { type Facts, measureBlock } from './layout-facts.ts'
import { blankLinesAfter, blankLinesBefore, byteOffsets, markedBlankEnd } from './layout-lines.ts'
import { cellRange, cellWraps, continuationRows, type TableRows, tableRows } from './layout-table.ts'
import { contentSource, type LayoutTrace } from './ast-inline.ts'
import { type BlockNode } from './tree.ts'

export const LAYOUT_VERSION = 2

/** C2-L-020: where one continuation row broke the content of a cell. */
export interface Wrap {
  line: number
  path: string
  offset: number
  row?: number
}

/** C2-L-009: the entry of one node. Every fact is optional, and an absent fact means unknown (C2-L-014). */
export interface NodeLayout {
  path: string
  startByte: number
  endByte: number
  bare?: boolean
  fenced?: boolean
  hardBreakOpener?: boolean
  wraps?: Wrap[]
  continuationLines?: number
  rawRef?: string
  sourceFormat?: 'pipe' | 'csv' | 'tsv'
  markerRaw?: string
  markerColumn?: number
  contentColumn?: number
  continuationStyle?: 'lazy' | 'indent' | 'marker_line' | 'none'
  blankLinesBefore?: number
  blankLinesAfter?: number
  openerRaw?: string
  closerRaw?: string
  metadataSeparatorRaw?: string
  attachment?: 'preceding' | 'none'
}

/** C2-L-007. */
export interface SourceLayout {
  version: 2
  encoding: 'utf-8'
  source: string
  lineEndings: 'none' | 'lf' | 'crlf' | 'cr' | 'mixed'
  bom: boolean
  nodes: NodeLayout[]
}

export function createLayoutTrace(): LayoutTrace {
  return { blocks: new Map(), inlines: new Map(), breaks: new Map() }
}

/** What a node hands to the nodes inside it: its source range, the open quotes, the lines of its content and its table. */
interface Frame {
  start: number
  end: number
  quotes: number
  /** The container is a quote, whose blank lines may stand behind its last content. */
  open: boolean
  spans: number[] | null
  table: TableRows | null
  row: number
}

interface Walk {
  src: string
  trace: LayoutTrace
  bytes: (offset: number) => number
  nodes: NodeLayout[]
}

function lineEndings(src: string): SourceLayout['lineEndings'] {
  let lf = false
  let crlf = false
  let cr = false
  for (let at = 0; at < src.length; at++) {
    const code = src.charCodeAt(at)
    if (code === LF) lf = true
    else if (code === CR && src.charCodeAt(at + 1) === LF) crlf = true
    else if (code === CR) cr = true
    if (code === CR && src.charCodeAt(at + 1) === LF) at++
  }
  const kinds = Number(lf) + Number(crlf) + Number(cr)
  if (kinds > 1) return 'mixed'
  if (kinds === 0) return 'none'
  return lf ? 'lf' : crlf ? 'crlf' : 'cr'
}

/** C2-L-012, C2-L-013: the range of a node is its `pos`, and otherwise runs from its first piece to its last. */
function addEntry(walk: Walk, node: AstNode, path: string, start: number, end: number, facts: Facts): void {
  const pos = node.pos
  walk.nodes.push({
    path,
    startByte: pos === undefined ? walk.bytes(start) : pos.startOffset,
    endByte: pos === undefined ? walk.bytes(end) : pos.endOffset,
    ...facts,
  })
}

function setBlankLines(walk: Walk, start: number, end: number, frame: Frame, facts: Facts, after = end): void {
  facts.blankLinesBefore = blankLinesBefore(walk.src, start, frame.start, frame.quotes)
  facts.blankLinesAfter = blankLinesAfter(walk.src, after, frame.end, frame.quotes, frame.open)
}

/** The offset of the first line of a block: its first attribute line, or its own markup. */
function firstOffset(origin: BlockNode): number {
  return origin.attributes !== null && origin.attributes.length > 0 ? origin.attributes[0]! : origin.start
}

/** C2-L-019. */
function visitRow(walk: Walk, node: AstNode, path: string, origin: BlockNode, frame: Frame): Frame {
  const row = frame.table?.index.get(origin) ?? -1
  if (frame.table === null || row < 0) return frame
  const count = continuationRows(walk.src, frame.table, row).length / 2
  if (count > 0) addEntry(walk, node, path, origin.start, origin.end, { continuationLines: count })
  return { ...frame, row }
}

function visitCell(walk: Walk, node: AstNode, path: string, origin: BlockNode, frame: Frame): Frame {
  if (frame.table !== null && frame.row >= 0) {
    const wraps = cellWraps(walk.src, walk.trace, frame.table, frame.row, node, origin, path)
    if (wraps.length > 0) {
      const range = cellRange(walk.src, frame.table, frame.row, origin)
      addEntry(walk, node, path, range[0], range[1], { wraps })
    }
  }
  return { ...frame, spans: origin.spans }
}

function visitBlock(walk: Walk, node: AstNode, path: string, origin: BlockNode, frame: Frame): Frame {
  if (origin.kind === ROW) return visitRow(walk, node, path, origin, frame)
  if (origin.kind === CELL) return visitCell(walk, node, path, origin, frame)
  const start = firstOffset(origin)
  // C2-A-154: a table and a figure group end behind their caption.
  const caption = node.caption === undefined ? undefined : walk.trace.blocks.get(node.caption)
  const end = caption === undefined ? origin.end : Math.max(origin.end, caption.end)
  const facts: Facts = {}
  measureBlock(walk.src, node, origin, frame.quotes, facts)
  const quote = origin.kind === QUOTE
  // C2-L-053: the blank lines that still carry the mark of a bare quote stand inside it.
  const after = quote && facts.fenced !== true ? markedBlankEnd(walk.src, end, frame.quotes + 1) : end
  setBlankLines(walk, start, end, frame, facts, after)
  addEntry(walk, node, path, start, end, facts)
  return {
    start, end, quotes: frame.quotes + (quote ? 1 : 0), open: quote, spans: origin.spans,
    table: origin.kind === TABLE ? tableRows(origin) : null, row: -1,
  }
}

/** A figure is made of the block it holds and the caption below it, and has no block of its own. */
function visitFigure(walk: Walk, node: AstNode, path: string, frame: Frame): Frame {
  const first = node.children?.[0]
  const target = first === undefined ? undefined : walk.trace.blocks.get(first)
  const caption = node.caption === undefined ? undefined : walk.trace.blocks.get(node.caption)
  if (target === undefined || caption === undefined) return frame
  const start = firstOffset(target)
  const facts: Facts = {}
  setBlankLines(walk, start, caption.end, frame, facts)
  addEntry(walk, node, path, start, caption.end, facts)
  return { ...frame, start, end: caption.end, open: false }
}

/** C2-L-022: the reference of a link or an image, from its opening bracket to the bracket that closes its label. */
function visitInline(walk: Walk, node: AstNode, path: string, frame: Frame): void {
  if (node.key === undefined || (node.type !== 'link' && node.type !== 'image')) return
  const origin = walk.trace.inlines.get(node)
  if (origin === undefined || origin.aux === 0) return
  const start = node.type === 'image' ? origin.start + 1 : origin.start
  // Inside a container the reference is read without the prefixes of the lines it crosses, as its label is.
  const rawRef = frame.spans === null ? walk.src.slice(start, origin.aux) : contentSource(walk.src, frame.spans, start, origin.aux)
  addEntry(walk, node, path, origin.start, origin.end, { rawRef })
}

function visit(walk: Walk, node: AstNode, path: string, frame: Frame): void {
  const origin = walk.trace.blocks.get(node)
  let inner = frame
  if (origin !== undefined) inner = visitBlock(walk, node, path, origin, frame)
  else if (node.type === 'figure') inner = visitFigure(walk, node, path, frame)
  else visitInline(walk, node, path, frame)
  // C2-L-011: document order, the slots in the order in which the source holds them, as positions are placed.
  if (Array.isArray(node.title)) visitList(walk, node.title, `${path}/title`, inner)
  if (node.children !== undefined) visitList(walk, node.children, `${path}/children`, inner)
  if (node.caption !== undefined) visit(walk, node.caption, `${path}/caption`, inner)
}

function visitList(walk: Walk, nodes: AstNode[], base: string, frame: Frame): void {
  for (let index = 0; index < nodes.length; index++) visit(walk, nodes[index]!, `${base}/${index}`, frame)
}

/** The record of `src` for `document`, the tree that was built with `trace`. */
export function buildLayout(src: string, document: AstNode, trace: LayoutTrace): SourceLayout {
  const walk: Walk = { src, trace, bytes: byteOffsets(src), nodes: [] }
  visit(walk, document, '', { start: 0, end: src.length, quotes: 0, open: false, spans: null, table: null, row: -1 })
  return {
    version: LAYOUT_VERSION, encoding: 'utf-8', source: src, lineEndings: lineEndings(src), bom: src.charCodeAt(0) === BYTE_ORDER_MARK,
    nodes: walk.nodes,
  }
}
