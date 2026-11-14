import { ENTER, EventCursor, SPAN } from './events.ts'
import {
  ATTRIBUTES, CELL, COMMENT, FLAG_ATTRIBUTES, FLAG_CONTINUATION, FLAG_SPAN_LEFT, FLAG_SPAN_UP, isLeaf, PARAGRAPH, ROW,
  TABLE,
} from './kinds.ts'


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
  spans: number[] | null
  attributes: number[] | null
}

/** Builds the block tree from the first `length` ints of an event array. */
export function buildTree(events: Int32Array, length: number): BlockNode {
  const open: BlockNode[] = []
  let root: BlockNode | null = null
  let top: BlockNode | null = null
  for (const event = new EventCursor(events, length); event.more(); event.next()) {
    const type = event.type()
    if (type === SPAN) {
      top!.spans!.push(event.start(), event.end())
    } else if (type === ENTER) {
      const node = enterNode(event.kind(), event.flags(), event.start(), event.aux(), top)
      if (top === null) root = node
      else top.children!.push(node)
      open.push(node)
      top = node
    } else {
      const node = open.pop()!
      node.end = event.end()
      node.exitFlags = event.flags()
      top = open.length > 0 ? open[open.length - 1]! : null
      exitNode(node, event.aux())
    }
  }
  return root!
}

function enterNode(kind: number, flags: number, start: number, aux: number, parent: BlockNode | null): BlockNode {
  const leaf = isLeaf(kind)
  const takes = (flags & FLAG_ATTRIBUTES) !== 0 && kind !== ATTRIBUTES
  return {
    kind, start, end: start, aux, flags, exitFlags: 0, facts: kind === CELL ? 1 : 0, rowFacts: kind === CELL ? 1 : 0,
    children: leaf ? null : [], spans: leaf ? [] : null,
    attributes: takes ? takeAttributes(parent!.children!) : null,
  }
}

/** The aux of a table's exit event is its head rows; the aux of its enter event the footer rows it asks for (C2-B-187). */
function exitNode(node: BlockNode, headRows: number): void {
  if (node.kind === TABLE) {
    node.facts = headRows
    const rows = resolveTable(node)
    // C2-B-187: the footer rows are the last rows of the body.
    node.rowFacts = Math.min(node.aux, rows - headRows)
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
 * Resolves the span marks of a closed table (C2-B-172, C2-B-183) and joins its continuation rows.
 * A cell that joins another is removed from its row; a mark that fails is an empty cell (C2-B-173).
 */
function resolveTable(table: BlockNode): number {
  const headRows = table.facts
  const kept: BlockNode[] = []
  let owners: (BlockNode | null)[] = []
  let last: BlockNode | null = null
  let rowIndex = 0
  for (const row of table.children!) {
    if (row.kind === ROW && (row.flags & FLAG_CONTINUATION) !== 0) {
      joinContinuation(row, last!, owners)
      continue
    }
    kept.push(row)
    if (row.kind !== ROW) continue
    // C2-B-174: a row span does not cross the head boundary.
    owners = resolveRow(row, rowIndex === headRows ? [] : owners)
    last = row
    rowIndex++
  }
  table.children = kept
  return rowIndex
}

/**
 * C2-B-184: each fragment of a continuation row joins the cell that covers its column in the row
 * above, after the span marks of that row are resolved; an empty fragment adds nothing.
 * C2-B-176: a fragment past the last column forms a new cell.
 */
function joinContinuation(row: BlockNode, above: BlockNode, owners: (BlockNode | null)[]): void {
  const fragments = row.children!
  for (let column = 0; column < fragments.length; column++) {
    const fragment = fragments[column]!
    if (column >= owners.length) {
      above.children!.push(fragment)
      owners.push(fragment)
    } else if (fragment.spans![0] !== fragment.spans![1]) {
      const spans = owners[column]!.spans!
      // C2-B-184, C2-L-021: the space stands between the text of the cell and the fragment, so an empty cell takes none.
      if (spans.length === 2 && spans[0] === spans[1]) spans.length = 0
      spans.push(fragment.spans![0]!, fragment.spans![1]!)
    }
  }
  above.end = row.end
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
    } else if ((cell.flags & FLAG_SPAN_UP) !== 0 && up !== null && up.facts === 1) {
      up.rowFacts++
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
