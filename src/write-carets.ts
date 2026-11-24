// C2-W-146, C2-W-092: a caret and a space that start a line of paragraph or line block text stay text that
// `unattached-caption` reports, so the caret takes a backslash. The plan places it in its line rule
// (write-plan-lines.ts); the repair reads no difference there and takes it from this walk.
import { childNodes, forEachSlot, type Node, type TextNode } from './ast.ts'

const CARET_LINE = /^\^ [ \t]*[^ \t]/
const CARET_ALONE = /^\^ [ \t]*$/

/** The caret escapes of the paragraphs and terms in `group`, by text node. */
export function caretLineEscapes(group: readonly Node[]): Map<TextNode, number[]> {
  const found = new Map<TextNode, number[]>()
  const stack: Node[] = [...group]
  for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
    // A term's first line starts behind its marker; its later lines read like paragraph text (C2-B-069).
    if (node.type === 'paragraph') scanLines(childNodes(node), true, found)
    else if (node.type === 'definition_term') scanLines(childNodes(node), false, found)
    else if (node.type === 'line') testLineStart(childNodes(node), 0, found)
    forEachSlot(node, (nodes) => { for (const child of nodes) stack.push(child) })
  }
  return found
}

function scanLines(nodes: readonly Node[], lineStart: boolean, found: Map<TextNode, number[]>): void {
  let start = lineStart
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    if (node.type === 'soft_break' || node.type === 'hard_break') {
      start = true
      continue
    }
    if (node.type === 'text') {
      if (start) testLineStart(nodes, at, found)
      if (node.value !== '') start = false
      continue
    }
    // Any other node writes a mark or a body first; a break inside it starts a line of the same paragraph.
    if ('children' in node && Array.isArray(node.children)) scanLines(node.children as Node[], false, found)
    start = false
  }
}

function testLineStart(nodes: readonly Node[], at: number, found: Map<TextNode, number[]>): void {
  const node = nodes[at]
  if (node?.type !== 'text') return
  if (CARET_LINE.test(node.value) || (CARET_ALONE.test(node.value) && contentBehind(nodes, at + 1))) found.set(node, [0])
}

function contentBehind(nodes: readonly Node[], from: number): boolean {
  const next = nodes[from]
  return next !== undefined && next.type !== 'soft_break' && next.type !== 'hard_break'
}
