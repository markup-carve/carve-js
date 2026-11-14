// The diagnostics record (C2-A-172, C2-A-173): its entries, and the position each one takes from the node it is about.
import { type DocumentNode, forEachSlot, type Node } from './ast.ts'

/** C2-A-173: one entry of the diagnostics record. */
export interface Diagnostic {
  code: string
  severity: 'error' | 'warning' | 'hint'
  channel: 'parse' | 'render-loss' | 'lint'
  message: string
  /** The node the entry is about, as an RFC 6901 pointer into the tree. The empty pointer is the document. */
  path?: string
  /** The range of that node in UTF-8 bytes of the source, where the tree carries positions. */
  range?: { startOffset: number, endOffset: number }
}

/** Entries, each with the node it is about, or null for the document. The positions are filled in once, at the end. */
export interface Findings {
  entries: Diagnostic[]
  nodes: (Node | null)[]
}

export function addFinding(findings: Findings, node: Node | null, entry: Diagnostic): void {
  findings.entries.push(entry)
  findings.nodes.push(node)
}

/** A node on the way down, with the step that leads to it from the node above. The pointer is spelled only for a node that is wanted. */
interface Frame {
  node: Node
  above: Frame | null
  step: string
}

function pushList(stack: Frame[], list: readonly Node[] | undefined, above: Frame, slot: string): void {
  if (list === undefined) return
  for (let at = list.length - 1; at >= 0; at--) stack.push({ node: list[at]!, above, step: `${slot}/${at}` })
}

/** The fields that hold nodes (C2-A-024), and the columns of a table, which are nodes too. */
function pushSlots(stack: Frame[], frame: Frame): void {
  const node = frame.node
  forEachSlot(node, (nodes, step, single) => {
    if (single) stack.push({ node: nodes[0]!, above: frame, step })
    else pushList(stack, nodes, frame, step)
  })
  if (node.type === 'table') pushList(stack, node.columns, frame, 'columns')
}

/** The pointer of the node of `frame`: the steps from the document down to it. */
function pointerOf(frame: Frame): string {
  const steps: string[] = []
  for (let at: Frame | null = frame; at !== null && at.above !== null; at = at.above) steps.push(at.step)
  return steps.length === 0 ? '' : `/${steps.reverse().join('/')}`
}

/** The pointer of each node of `wanted` that stands in the tree below `document`. */
function pointers(document: DocumentNode, wanted: Set<Node>): Map<Node, string> {
  const found = new Map<Node, string>()
  const stack: Frame[] = [{ node: document, above: null, step: '' }]
  while (stack.length > 0 && found.size < wanted.size) {
    const frame = stack.pop()!
    if (wanted.has(frame.node)) found.set(frame.node, pointerOf(frame))
    pushSlots(stack, frame)
  }
  return found
}

/**
 * C2-A-173: gives every entry its position: the pointer of its node, and the byte range of that
 * node where it has one. An entry about the document, or about a node that is not in the tree,
 * points at the document. The tree is walked once, and only when there is an entry.
 */
export function locateFindings(document: DocumentNode, findings: Findings): Diagnostic[] {
  const { entries, nodes } = findings
  if (entries.length === 0) return entries
  const wanted = new Set<Node>()
  for (const node of nodes) if (node !== null) wanted.add(node)
  const found = pointers(document, wanted)
  entries.forEach((entry, at) => {
    const node = nodes[at] ?? null
    const path = node === null ? undefined : found.get(node)
    entry.path = path ?? ''
    const pos = path === undefined || node === null ? undefined : node.pos
    if (pos !== undefined) entry.range = { startOffset: pos.startOffset, endOffset: pos.endOffset }
  })
  return entries
}
