import { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, SPAN } from './events.ts'
import { isPlainText, scanInline } from './inline-scan.ts'
import { type InlineState } from './inline-state.ts'
import { buildInlineTree, type InlineNode, LINE, textNode } from './inline-tree.ts'
import {
  ATTRIBUTES, CAPTION, CELL, COMMENT, DIV, DOCUMENT, FLAG_ATTRIBUTES, FLAG_CONTINUATION, FLAG_SPAN_LEFT, FLAG_SPAN_UP,
  HEADING, isLeaf, LINE_BLOCK, PARAGRAPH, ROW, TABLE, TERM,
} from './kinds.ts'

// The facts of a table are its head rows and, above FACT_SHIFT, its footer rows.
// The facts of a cell are the columns and, above FACT_SHIFT, the rows it spans.
export const FACT_SHIFT = 16
export const FACT_MASK = (1 << FACT_SHIFT) - 1
const ONE_BY_ONE = 1 | (1 << FACT_SHIFT)

/**
 * One field layout for every block. A container has `children`, a leaf has `spans` (start, end pairs).
 * `attributes` holds the spans of the attribute lines the block took. `inlines` is the inline
 * content of a text leaf and of a cell, and one LINE node per line of a line block, once
 * `readInlines` has run.
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
  inlines: InlineNode[] | null
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
      exitNode(node, b)
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
    inlines: null,
  }
}

function exitNode(node: BlockNode, facts: number): void {
  if (node.kind === TABLE) {
    node.facts = facts
    resolveTable(node)
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
function resolveTable(table: BlockNode): void {
  const headRows = table.facts & FACT_MASK
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
      owners[column]!.spans!.push(fragment.spans![0]!, fragment.spans![1]!)
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

/** The source of `[start, end)` without the prefixes of the lines it crosses: its parts inside `spans`, joined by line feeds. */
function contentSource(src: string, spans: number[], start: number, end: number): string {
  const lines: string[] = []
  for (let at = 0; at < spans.length; at += 2) {
    const from = Math.max(start, spans[at]!)
    const to = Math.min(end, spans[at + 1]!)
    if (from < to) lines.push(src.slice(from, to))
  }
  return lines.join('\n')
}

function hasInlineContent(kind: number): boolean {
  return kind === PARAGRAPH || kind === HEADING || kind === TERM || kind === CAPTION || kind === CELL
}

/** The inline nodes of the content `spans[from..to)` of a leaf. */
function contentInlines(state: InlineState, src: string, spans: number[], from: number, to: number, depth: number, lineComments: boolean): InlineNode[] {
  // One line of plain text is one text node, with no pass over it.
  if (to - from === 2 && isPlainText(src, spans[from]!, spans[from + 1]!)) return [textNode(src.slice(spans[from], spans[from + 1]), spans[from]!, spans[from + 1]!)]
  scanInline(state, src, spans, from, to, depth, lineComments)
  return buildInlineTree(src, state.events, state.eventLength, (start, end) => contentSource(src, spans, start, end))
}

/** C2-B-130, C2-B-144: each line of a line block is a content of its own, and `%%` is text in it. */
function lineInlines(state: InlineState, src: string, spans: number[], depth: number): InlineNode[] {
  const lines: InlineNode[] = []
  for (let at = 0; at < spans.length; at += 2) {
    lines.push({
      kind: LINE, start: spans[at]!, end: spans[at + 1]!, flags: 0, aux: 0,
      children: contentInlines(state, src, spans, at, at + 2, depth, false),
      value: null, destination: null, title: null, label: null, attributes: null,
    })
  }
  return lines
}

/**
 * C2-I-001: reads the inline content of every text leaf and cell below `node`, after the block
 * pass. `depth` is the number of open containers around `node` (C2-I-118).
 */
export function readInlines(state: InlineState, src: string, node: BlockNode, depth: number): void {
  if (node.children !== null) {
    const inner = node.kind > DOCUMENT && node.kind <= DIV ? depth + 1 : depth
    for (const child of node.children) readInlines(state, src, child, inner)
  } else if (hasInlineContent(node.kind)) {
    node.inlines = contentInlines(state, src, node.spans!, 0, node.spans!.length, depth, true)
  } else if (node.kind === LINE_BLOCK) {
    node.inlines = lineInlines(state, src, node.spans!, depth)
  }
}
