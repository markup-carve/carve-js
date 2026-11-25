import { type Attributes, readAttributeLines } from './ast-attributes.ts'
import { ENTER, EventCursor, SPAN } from './events.ts'
import {
  ATTRIBUTES, CELL, COMMENT, FLAG_ATTRIBUTES, FLAG_CONTINUATION, FLAG_SPAN_LEFT, FLAG_SPAN_UP,
  isLeaf, PARAGRAPH, ROW,
  TABLE,
} from './kinds.ts'
import { bodyPartition, bodyStarts } from './table-bodies.ts'


/**
 * One field layout for every block. A container has `children`, a leaf has `spans` (start, end pairs).
 * `attributes` holds the spans of the attribute lines the block took.
 */
export interface BlockNode {
  kind: number
  start: number
  end: number
  aux: number
  flags: number
  exitFlags: number
  /** The head rows of a table, the columns a cell spans. */
  facts: number
  /** The footer rows of a table, the rows a cell spans. */
  rowFacts: number
  children: BlockNode[] | null
  /** The content of a leaf; for a table row, the text between the pipes of each span mark it merged (C2-A-149). */
  spans: number[] | null
  /** Compact lint-only empty span, materialized if a continuation needs the array. */
  emptySpan?: number
  attributes: number[] | null
  /** C2-B-024: the indexes in `spans` of the lazy comment-only lines of a line block. */
  lazyComments?: number[]
}

/** Builds the block tree from the first `length` ints of an event array. */
export function buildTree(events: Int32Array, length: number, src = '', compact = false): BlockNode {
  const open: BlockNode[] = []
  let root: BlockNode | null = null
  let top: BlockNode | null = null
  for (const event = new EventCursor(events, length); event.more(); event.next()) {
    const type = event.type()
    if (type === SPAN) {
      if (event.kind() === COMMENT) (top!.lazyComments ??= []).push(top!.spans!.length)
      appendSpan(top!, event.start(), event.end(), compact)
    } else if (type === ENTER) {
      const node = enterNode(event.kind(), event.flags(), event.start(), event.aux(), top, compact)
      if (top === null) root = node
      else top.children!.push(node)
      open.push(node)
      top = node
    } else {
      const node = open.pop()!
      node.end = event.end()
      setExitFlags(node, event.flags(), compact)
      top = open.length > 0 ? open[open.length - 1]! : null
      exitNode(node, event.aux(), src)
    }
  }
  return root!
}

const COMPACT_CELL_DEFAULTS = { kind: CELL, exitFlags: 0, facts: 1, rowFacts: 1, children: null, attributes: null,
  spans: null }

export function spansOf(node: BlockNode): number[] {
  if (node.spans !== null) return node.spans
  const at = node.emptySpan!
  delete node.emptySpan
  return (node.spans = [at, at])
}

function appendSpan(node: BlockNode, start: number, end: number, compact: boolean): void {
  if (compact && node.kind === CELL && node.spans === null && start === end) {
    node.emptySpan = start
    return
  }
  if (compact && node.kind === CELL && node.spans === null && node.emptySpan === undefined) {
    node.spans = [start, end]
    return
  }
  spansOf(node).push(start, end)
}

function setExitFlags(node: BlockNode, flags: number, compact: boolean): void {
  if (!compact || flags !== 0) node.exitFlags = flags
}

function enterNode(kind: number, flags: number, start: number, aux: number, parent: BlockNode | null,
  compact: boolean): BlockNode {
  if (compact && kind === CELL && (flags & FLAG_ATTRIBUTES) === 0) {
    return Object.assign(Object.create(COMPACT_CELL_DEFAULTS) as BlockNode, { start, end: start, aux, flags })
  }
  const leaf = isLeaf(kind)
  const takes = (flags & FLAG_ATTRIBUTES) !== 0 && kind !== ATTRIBUTES
  return {
    kind, start, end: start, aux, flags, exitFlags: 0, facts: kind === CELL ? 1 : 0, rowFacts: kind === CELL ? 1 : 0,
    children: leaf ? null : [], spans: leaf ? [] : null,
    attributes: takes ? takeAttributes(parent!.children!) : null,
  }
}

/** The aux of a table's exit event is its head rows; the aux of its enter event the footer rows it asks for (C2-B-187). */
function exitNode(node: BlockNode, headRows: number, src: string): void {
  if (node.kind === TABLE) {
    node.facts = headRows
    const rows = resolveTable(node, src)
    // C2-B-187: the footer rows are the last rows of the body.
    node.rowFacts = Math.min(node.aux, rows - node.facts)
  }
  if (node.children !== null) orphanAttributes(node.children)
}

/**
 * Removes the pending attribute lines at the end of `siblings` and returns their spans. Comments
 * between them stay (C2-B-137). An attribute line with the flag merges with the one before it (C2-B-102).
 */
function takeAttributes(siblings: BlockNode[]): number[] {
  let first = siblings.length
  let merges = true
  for (let at = siblings.length - 1; at >= 0 && merges; at--) {
    const sibling = siblings[at]!
    if (sibling.kind === COMMENT) continue
    if (sibling.kind !== ATTRIBUTES) break
    first = at
    merges = (sibling.flags & FLAG_ATTRIBUTES) !== 0
  }
  const spans: number[] = []
  let kept = first
  for (let at = first; at < siblings.length; at++) {
    const sibling = siblings[at]!
    if (sibling.kind === ATTRIBUTES) spans.push(sibling.spans![0]!, sibling.spans![1]!)
    else siblings[kept++] = sibling
  }
  siblings.length = kept
  return spans
}

/** C2-B-092: attribute lines that no block took are one paragraph that holds them as text. */
function mergeOrphanAttribute(children: BlockNode[], kept: number, child: BlockNode): number {
  if (child.kind !== ATTRIBUTES || (child.flags & FLAG_ATTRIBUTES) === 0) return -1
  let previous = kept - 1
  while (previous >= 0 && children[previous]!.kind === COMMENT) previous--
  const before = previous >= 0 ? children[previous]! : null
  if (before === null || before.kind !== PARAGRAPH) return -1
  // C2-B-137, C2-B-138, C2-B-192: comments are invisible to the run of
  // refused attribute lines and become inline children of its paragraph.
  for (let index = previous + 1; index < kept; index++) {
    const comment = children[index]!
    before.spans!.push(comment.spans![0]!, comment.spans![1]!)
  }
  before.spans!.push(child.spans![0]!, child.spans![1]!)
  before.end = child.end
  return previous + 1
}

function orphanAttributes(children: BlockNode[]): void {
  let kept = 0
  for (let at = 0; at < children.length; at++) {
    const child = children[at]!
    const merged = mergeOrphanAttribute(children, kept, child)
    if (merged >= 0) { kept = merged; continue }
    if (child.kind === ATTRIBUTES) child.kind = PARAGRAPH
    children[kept++] = child
  }
  children.length = kept
}

/**
 * Resolves the span marks of a closed table (C2-B-172, C2-B-183) and joins its continuation rows.
 * A cell that joins another is removed from its row; a mark that joins nothing is the text of its cell (C2-B-173).
 */
function resolveTable(table: BlockNode, src: string): number {
  let rows = 0
  for (const row of table.children!) if (row.kind === ROW && (row.flags & FLAG_CONTINUATION) === 0) rows++
  const attributes = tableAttributes(table, src)
  const headRows = endHead(table, attributes, rows)
  // C2-B-187: the footer rows are the last rows below the head.
  const footStart = rows - Math.min(table.aux, rows - headRows)
  const bodies = bodyBoundaries(attributes, headRows, footStart)
  const kept: BlockNode[] = []
  let owners: (BlockNode | null)[] = []
  let last: BlockNode | null = null
  let rowIndex = 0
  const pending: number[][] = []
  for (const row of table.children!) {
    if (row.kind === ROW && (row.flags & FLAG_CONTINUATION) !== 0) {
      joinContinuation(row, last!, owners, pending)
      continue
    }
    if (pending.length > 0) joinPending(owners, pending)
    kept.push(row)
    if (row.kind !== ROW) continue
    // C2-B-174: no span crosses from the head into the body, from one body into the next or from the body into the foot.
    owners = resolveRow(row, rowIndex === headRows || rowIndex === footStart || bodies.has(rowIndex) ? [] : owners)
    last = row
    rowIndex++
  }
  if (pending.length > 0) joinPending(owners, pending)
  table.children = kept
  return rowIndex
}

function tableAttributes(table: BlockNode, src: string): Attributes | null {
  return table.attributes === null || table.attributes.length === 0 || src === '' ? null : readAttributeLines(src, table.attributes)
}

/** C2-B-187: an empty `body-rows` ends the head above a footer count smaller than the rows. Returns the head rows. */
function endHead(table: BlockNode, attributes: Attributes | null, rows: number): number {
  if (table.aux < rows && table.facts > rows - table.aux && bodyPartition(attributes, 0)?.data.length === 0) {
    table.facts = rows - table.aux
  }
  return table.facts
}

/** C2-B-230: the row indexes at which a body of `body-rows` starts. */
function bodyBoundaries(attributes: Attributes | null, headRows: number, footStart: number): Set<number> {
  if (attributes === null) return new Set()
  const partition = bodyPartition(attributes, footStart - headRows)
  return new Set(partition === null ? [] : bodyStarts(partition).map((start) => start + headRows))
}

/**
 * C2-B-184: each fragment of a continuation row joins the cell that covers its column in the row
 * above, after the span marks of that row are resolved; an empty fragment adds nothing.
 * C2-B-176: a fragment past the last column forms a new cell.
 * The fragments of a cell over several columns wait in `pending`, per column, until the rows below the row above end.
 */
function joinContinuation(row: BlockNode, above: BlockNode, owners: (BlockNode | null)[], pending: number[][]): void {
  const fragments = row.children!
  for (let column = 0; column < fragments.length; column++) {
    const fragment = fragments[column]!
    const fragmentSpans = spansOf(fragment)
    if (column >= owners.length) {
      above.children!.push(fragment)
      owners.push(fragment)
    } else if (fragmentSpans[0] !== fragmentSpans[1]) {
      const owner = owners[column]!
      if (owner.facts > 1) {
        while (pending.length <= column) pending.push([])
        pending[column]!.push(fragmentSpans[0]!, fragmentSpans[1]!)
      } else {
        joinSpans(owner, fragmentSpans[0]!, fragmentSpans[1]!)
      }
    }
  }
  above.end = row.end
}

function joinSpans(owner: BlockNode, start: number, end: number): void {
  const spans = spansOf(owner)
  // C2-B-184, C2-L-021: the space stands between the text of the cell and the fragment, so an empty cell takes none.
  if (spans.length === 2 && spans[0] === spans[1]) spans.length = 0
  spans.push(start, end)
}

/**
 * carve#6691 (PART 9 §5 T6 of 0.1): a cell holds its fragments position by position, its columns in
 * order and the fragments of one column in the order of their rows.
 */
function joinPending(owners: (BlockNode | null)[], pending: number[][]): void {
  for (let column = 0; column < pending.length; column++) {
    const fragments = pending[column]!
    for (let at = 0; at < fragments.length; at += 2) joinSpans(owners[column]!, fragments[at]!, fragments[at + 1]!)
  }
  pending.length = 0
}

function markSpan(row: BlockNode, cell: BlockNode): void {
  row.spans ??= []
  row.spans.push(cell.start + 1, cell.end)
}

/** Resolves one row against the cells that own each column of the row above, and returns its own owners. */
function resolveRow(row: BlockNode, above: (BlockNode | null)[]): (BlockNode | null)[] {
  const owners: (BlockNode | null)[] = []
  const kept: BlockNode[] = []
  let left: BlockNode | null = null
  for (const cell of row.children!) {
    const column = owners.length
    const up = above[column] ?? null
    if ((cell.flags & FLAG_SPAN_LEFT) !== 0 && left !== null) {
      left.facts++
      owners.push(left)
      markSpan(row, cell)
    } else if ((cell.flags & FLAG_SPAN_UP) !== 0 && up !== null && up.facts === 1) {
      up.rowFacts++
      markSpan(row, cell)
      // A cell joined upward has no cell of this row to its left to extend.
      owners.push(up)
      left = null
    } else {
      // C2-B-173: a mark that joins nothing is an ordinary cell, its prefix applied, that holds the mark as text.
      cell.flags &= ~(FLAG_SPAN_LEFT | FLAG_SPAN_UP)
      kept.push(cell)
      owners.push(cell)
      left = cell
    }
  }
  row.children = kept
  return owners
}
