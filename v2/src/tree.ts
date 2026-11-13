import { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, SPAN } from './events.ts'
import { ATTRIBUTES, COMMENT, FLAG_ATTRIBUTES, isLeaf, PARAGRAPH } from './kinds.ts'

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
      const kind = eventKind(tag)
      const leaf = isLeaf(kind)
      const flags = eventFlags(tag)
      const node: BlockNode = {
        kind, start: a, end: a, aux: b, flags, exitFlags: 0,
        children: leaf ? null : [], spans: leaf ? [] : null,
        attributes: (flags & FLAG_ATTRIBUTES) !== 0 && kind !== ATTRIBUTES ? takeAttributes(top!.children!) : null,
      }
      if (top === null) root = node
      else top.children!.push(node)
      open.push(node)
      top = node
    } else {
      const node = open.pop()!
      node.end = a
      node.exitFlags = eventFlags(tag)
      if (node.children !== null) orphanAttributes(node.children)
      top = open.length > 0 ? open[open.length - 1]! : null
    }
  }
  return root!
}

/**
 * Removes the pending attribute lines at the end of `siblings` and returns their spans. Comments
 * between them stay (C2-B-095). An attribute line with the flag merges with the one before it (C2-B-071).
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

/** C2-B-070: an attribute line that no block took is a one-line paragraph. */
function orphanAttributes(children: BlockNode[]): void {
  for (const child of children) if (child.kind === ATTRIBUTES) child.kind = PARAGRAPH
}
