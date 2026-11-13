// The diagnostics record (C2-A-172, C2-A-173): its entries, and the position each one takes from the node it is about.
import { type AstNode } from './ast.ts'

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
  nodes: (AstNode | null)[]
}

export function addFinding(findings: Findings, node: AstNode | null, entry: Diagnostic): void {
  findings.entries.push(entry)
  findings.nodes.push(node)
}

// The fields that hold nodes, besides `children`: one node, a list, or the two lists of each ruby pair.
const NODE_LISTS = ['children', 'title', 'fallback', 'short', 'prefix', 'locator', 'suffix', 'columns'] as const
const PAIR_LISTS = ['base', 'annotation'] as const

interface Frame {
  node: AstNode
  path: string
}

function pushList(stack: Frame[], list: unknown, path: string): void {
  if (!Array.isArray(list)) return
  const nodes = list as AstNode[]
  for (let at = nodes.length - 1; at >= 0; at--) stack.push({ node: nodes[at]!, path: `${path}/${at}` })
}

/** RFC 6901: `~` and `/` in a key are written as `~0` and `~1`. */
function pointerKey(key: string): string {
  return key.replaceAll('~', '~0').replaceAll('/', '~1')
}

function pushSlots(stack: Frame[], frame: Frame): void {
  const { node, path } = frame
  for (const name of NODE_LISTS) pushList(stack, node[name], `${path}/${name}`)
  if (node.caption !== undefined) stack.push({ node: node.caption, path: `${path}/caption` })
  ;(node.pairs ?? []).forEach((pair, at) => {
    for (const name of PAIR_LISTS) pushList(stack, pair[name], `${path}/pairs/${at}/${name}`)
  })
  for (const [name, list] of Object.entries(node.slots ?? {})) pushList(stack, list, `${path}/slots/${pointerKey(name)}`)
}

/** The pointer of each node of `wanted` that stands in the tree below `document`. */
function pointers(document: AstNode, wanted: Set<AstNode>): Map<AstNode, string> {
  const found = new Map<AstNode, string>()
  const stack: Frame[] = [{ node: document, path: '' }]
  while (stack.length > 0 && found.size < wanted.size) {
    const frame = stack.pop()!
    if (wanted.has(frame.node)) found.set(frame.node, frame.path)
    pushSlots(stack, frame)
  }
  return found
}

/**
 * C2-A-173: gives every entry its position: the pointer of its node, and the byte range of that
 * node where it has one. An entry about the document, or about a node that is not in the tree,
 * points at the document. The tree is walked once, and only when there is an entry.
 */
export function locateFindings(document: AstNode, findings: Findings): Diagnostic[] {
  const { entries, nodes } = findings
  if (entries.length === 0) return entries
  const wanted = new Set<AstNode>()
  for (const node of nodes) if (node !== null) wanted.add(node)
  const found = pointers(document, wanted)
  entries.forEach((entry, at) => {
    const node = nodes[at] ?? null
    const path = node === null ? undefined : found.get(node)
    entry.path = path ?? ''
    const pos = path === undefined ? undefined : node!.pos
    if (pos !== undefined) entry.range = { startOffset: pos.startOffset, endOffset: pos.endOffset }
  })
  return entries
}
