import { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, SPAN } from './events.ts'
import {
  ATTRIBUTES, CELL, COMMENT, FLAG_ATTRIBUTES, FLAG_CONTINUATION, FLAG_SPAN_LEFT, FLAG_SPAN_UP, isLeaf, PARAGRAPH,
  ROW, TABLE,
} from './kinds.ts'

// The facts of a table are its head rows and, above FACT_SHIFT, its footer rows.
// The facts of a cell are the columns and, above FACT_SHIFT, the rows it spans.
export const FACT_SHIFT = 16
export const FACT_MASK = (1 << FACT_SHIFT) - 1
const ONE_BY_ONE = 1 | (1 << FACT_SHIFT)

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
  facts: number
  children: BlockNode[] | null
  spans: number[] | null
  attributes: number[] | null
}

/** Builds the block tree from the first `length` ints of an event array. */
export function buildTree(events: Int32Array, length: number): BlockNode {
  const open: BlockNode[] = []
  let root: BlockNode | null = null
  let top: BlockNode | null = null
  for (let at = 0; at < length; at += EVENT_WIDTH) {
    const tag = events[at]!
    const a = events[at + 1]!
    const b = events[at + 2]!
    const type = eventType(tag)
    if (type === SPAN) {
      top!.spans!.push(a, b)
    } else if (type === ENTER) {
      const node = enterNode(eventKind(tag), eventFlags(tag), a, b, top)
      if (top === null) root = node
      else top.children!.push(node)
      open.push(node)
      top = node
    } else {
      const node = open.pop()!
      node.end = a
      node.exitFlags = eventFlags(tag)
      top = open.length > 0 ? open[open.length - 1]! : null
      exitNode(node, b, top)
    }
  }
  return root!
}

function enterNode(kind: number, flags: number, start: number, aux: number, parent: BlockNode | null): BlockNode {
  const leaf = isLeaf(kind)
  const takes = (flags & FLAG_ATTRIBUTES) !== 0 && kind !== ATTRIBUTES
  return {
    kind, start, end: start, aux, flags, exitFlags: 0, facts: kind === CELL ? ONE_BY_ONE : 0,
    children: leaf ? null : [], spans: leaf ? [] : null,
    attributes: takes ? takeAttributes(parent!.children!) : null,
  }
}

function exitNode(node: BlockNode, facts: number, parent: BlockNode | null): void {
  if (node.kind === TABLE) {
    node.facts = facts
    resolveSpans(node)
  } else if (node.kind === ROW && (node.flags & FLAG_CONTINUATION) !== 0) {
    joinContinuation(node, parent!.children!)
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
function orphanAttributes(children: BlockNode[]): void {
  let kept = 0
  for (let at = 0; at < children.length; at++) {
    const child = children[at]!
    const before = kept > 0 ? children[kept - 1]! : null
    if (child.kind === ATTRIBUTES && (child.flags & FLAG_ATTRIBUTES) !== 0 && before !== null && before.kind === PARAGRAPH) {
      before.spans!.push(child.spans![0]!, child.spans![1]!)
      before.end = child.end
      continue
    }
    if (child.kind === ATTRIBUTES) child.kind = PARAGRAPH
    children[kept++] = child
  }
  children.length = kept
}

/**
 * C2-B-184: each fragment of a continuation row joins the cell of its column in the row above;
 * an empty fragment adds nothing. C2-B-176: a fragment past the last column forms a new cell.
 */
function joinContinuation(row: BlockNode, rows: BlockNode[]): void {
  rows.pop()
  let above = rows.length - 1
  while (rows[above]!.kind !== ROW) above--
  const cells = rows[above]!.children!
  const fragments = row.children!
  for (let column = 0; column < fragments.length; column++) {
    const fragment = fragments[column]!
    if (column >= cells.length) {
      cells.push(fragment)
    } else if (fragment.spans![0] !== fragment.spans![1]) {
      cells[column]!.spans!.push(fragment.spans![0]!, fragment.spans![1]!)
    }
  }
  rows[above]!.end = row.end
}

/**
 * Resolves the span marks of a closed table (C2-B-172, C2-B-183). A cell that joins another is
 * removed from its row; a mark that fails is an empty cell (C2-B-173).
 */
function resolveSpans(table: BlockNode): void {
  const headRows = table.facts & FACT_MASK
  let above: (BlockNode | null)[] = []
  let rowIndex = 0
  for (const row of table.children!) {
    if (row.kind !== ROW) continue
    // C2-B-174: a row span does not cross the head boundary.
    above = resolveRow(row, rowIndex === headRows ? [] : above)
    rowIndex++
  }
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
    } else if ((cell.flags & FLAG_SPAN_UP) !== 0 && up !== null && (up.facts & FACT_MASK) === 1) {
      up.facts += 1 << FACT_SHIFT
      // A cell joined upward has no cell of this row to its left to extend.
      owners.push(up)
      left = null
    } else {
      if ((cell.flags & (FLAG_SPAN_LEFT | FLAG_SPAN_UP)) !== 0) cell.spans = []
      kept.push(cell)
      owners.push(cell)
      left = cell
    }
  }
  row.children = kept
  return owners
}
