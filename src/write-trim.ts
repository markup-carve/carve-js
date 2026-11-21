// C2-W-151: spaces and tabs that would end a source line in text are insignificant. They are taken out of the
// supplied tree while the writer runs, so neither the write nor its comparison sees them, and put back after it.
// Nodes keep their identity, so a loss is still located in the tree as supplied.
import { forEachSlot, type Node, type TableNode, type TextNode } from './ast.ts'

/** The block nodes whose inline content ends at a line end. */
const LINE_HOLDERS: ReadonlySet<string> = new Set([
  'paragraph', 'heading', 'definition_term', 'cell_paragraph', 'line', 'citation_definition',
])

function trimmedEnd(value: string): number {
  let end = value.length
  while (end > 0 && (value.charCodeAt(end - 1) === 32 || value.charCodeAt(end - 1) === 9)) end--
  return end
}

/**
 * Drops the spaces and tabs at the end of each text node that stands before a soft break or at the end of the
 * content of a line holder, and the text nodes that hold nothing else. `delimited` says whether a table is written
 * in a delimited form, where a cell keeps them as data (C2-W-066). Returns the function that restores the tree, or
 * null where nothing changed.
 */
export function trimLineEnds(document: Node, delimited: (table: TableNode) => boolean): (() => void) | null {
  const values: [TextNode, string][] = []
  const removed: [Node[], number, Node][] = []
  const pending: Node[] = [document]
  for (;;) {
    const node = pending.pop()
    if (node === undefined) break
    if (node.type === 'text') continue
    if (node.type === 'table' && delimited(node)) continue
    const holder = LINE_HOLDERS.has(node.type)
    forEachSlot(node, (list, step, single) => {
      const nodes = list as Node[]
      const atLineEnd = holder && step === 'children'
      for (let i = nodes.length - 1; i >= 0; i--) {
        const child = nodes[i]!
        if (child.type !== 'text') {
          pending.push(child)
          continue
        }
        const next = nodes[i + 1]
        if (single || (next === undefined ? !atLineEnd : next.type !== 'soft_break')) continue
        const end = trimmedEnd(child.value)
        if (end === child.value.length) continue
        if (end > 0) {
          values.push([child, child.value])
          child.value = child.value.slice(0, end)
          continue
        }
        removed.push([nodes, i, child])
        nodes.splice(i, 1)
      }
    })
  }
  if (values.length === 0 && removed.length === 0) return null
  return () => {
    for (let at = removed.length - 1; at >= 0; at--) {
      const [nodes, i, child] = removed[at]!
      nodes.splice(i, 0, child)
    }
    for (const [text, value] of values) text.value = value
  }
}
