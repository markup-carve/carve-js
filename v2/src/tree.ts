import { ENTER, EVENT_WIDTH, eventFlags, eventKind, eventType, SPAN } from './events.ts'
import { FLAG_TIGHT, isLeaf, isList } from './kinds.ts'

/** One field layout for every block. A container has `children`, a leaf has `spans` (start, end pairs). */
export interface BlockNode {
  kind: number
  start: number
  end: number
  aux: number
  flags: number
  tight: boolean
  children: BlockNode[] | null
  spans: number[] | null
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
      const node: BlockNode = {
        kind, start: a, end: a, aux: b, flags: eventFlags(tag), tight: false,
        children: leaf ? null : [], spans: leaf ? [] : null,
      }
      if (top === null) root = node
      else top.children!.push(node)
      open.push(node)
      top = node
    } else {
      const node = open.pop()!
      node.end = a
      node.tight = isList(node.kind) && (eventFlags(tag) & FLAG_TIGHT) !== 0
      top = open.length > 0 ? open[open.length - 1]! : null
    }
  }
  return root!
}
