// The annotation text of a node (C2-A-207) and the offsets of an annotation-range sidecar into it (C2-A-214).
import { forEachSlot, isRecord, type Node, pointerToken } from './ast.ts'
import { unitBytes } from './positions.ts'

/** The node at the RFC 6901 pointer `path` of `root`, or null. */
export function nodeAtPointer(root: Node, path: string): Node | null {
  if (path === '') return root
  let at: unknown = root
  for (const part of path.split('/').slice(1)) {
    if (!isRecord(at) && !Array.isArray(at)) return null
    at = Reflect.get(at, pointerToken(part))
  }
  return isNode(at) ? at : null
}

function isNode(value: unknown): value is Node {
  return isRecord(value) && typeof value['type'] === 'string'
}

function stringField(node: Node, name: string): string | null {
  const value: unknown = Reflect.get(node, name)
  return typeof value === 'string' ? value : null
}

function ownText(node: Node): string {
  if (node.type === 'smart_punctuation') return node.source
  if (node.type === 'soft_break' || node.type === 'hard_break') return '\n'
  if (node.type === 'non_breaking_space') return '\u00a0'
  return stringField(node, 'value') ?? stringField(node, 'alt') ?? ''
}

/** C2-A-207: the `value`, `alt` or `source` of the node, then the text of its child slots in the order of node-slots.json. */
export function annotationText(node: Node): string {
  const parts = [ownText(node)]
  const pending: Node[][] = []
  forEachSlot(node, (nodes) => pending.push([...nodes]))
  for (const nodes of pending) for (const child of nodes) parts.push(annotationText(child))
  return parts.join('')
}

/** C2-A-207, C2-A-214: whether `offset` is a UTF-8 byte offset of `text` that falls between two characters. */
export function isCharacterBoundary(text: string, offset: number): boolean {
  let bytes = 0
  for (let at = 0; at < text.length && bytes < offset; at++) {
    bytes += unitBytes(text, at)
    // A surrogate pair is one character: its second half is no boundary.
    if (isHighSurrogate(text, at)) bytes += unitBytes(text, ++at)
  }
  return bytes === offset
}

function isHighSurrogate(text: string, at: number): boolean {
  const code = text.charCodeAt(at)
  const next = text.charCodeAt(at + 1)
  return code >= 0xd800 && code <= 0xdbff && next >= 0xdc00 && next <= 0xdfff
}
