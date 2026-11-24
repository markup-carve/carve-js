// The diagnostics record (C2-A-172, C2-A-173): its entries, and the position each one takes from the node it is about.
import { type DocumentNode, type ExtensionDeclaration, forEachSlot, type Node, SOURCE_ORDER } from './ast.ts'

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
  /** C2-N-063, C2-N-087: the id of the included file the range is counted in; absent for the top-level document. */
  file?: string
  /** C2-T-020: include directives from the entry file inward. */
  includedBy?: { file?: string, range: { startOffset: number, endOffset: number } }[]
}

/** Entries, each with the node it is about, or null for the document. The positions are filled in once, at the end. */
export interface Findings {
  entries: Diagnostic[]
  nodes: (Node | null)[]
  /** The pointer below its node of an entry about a part of the node, such as one key of its `attrs`. */
  steps?: Map<Diagnostic, string>
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
  /** C2-N-053: the file of the node, the `file` of the nearest expanded include around it, or undefined for the top level. */
  file: string | undefined
}

function pushList(stack: Frame[], list: readonly Node[] | undefined, above: Frame, slot: string, file: string | undefined): void {
  if (list === undefined) return
  for (let at = list.length - 1; at >= 0; at--) stack.push({ node: list[at]!, above, step: `${slot}/${at}`, file })
}

/** The fields that hold nodes (C2-A-024), and the columns of a table, which are nodes too. */
function pushSlots(stack: Frame[], frame: Frame, declarations: readonly ExtensionDeclaration[]): void {
  const node = frame.node
  const file = node.type === 'include' && node.children !== undefined ? node.file : frame.file
  forEachSlot(node, (nodes, step, single) => {
    if (single) stack.push({ node: nodes[0]!, above: frame, step, file: frame.file })
    else pushList(stack, nodes, frame, step, step === 'children' ? file : frame.file)
  }, undefined, declarations)
}

/** The pointer of the node of `frame`: the steps from the document down to it. */
function pointerOf(frame: Frame): string {
  const steps: string[] = []
  for (let at: Frame | null = frame; at !== null && at.above !== null; at = at.above) steps.push(at.step)
  return steps.length === 0 ? '' : `/${steps.reverse().join('/')}`
}

interface Place {
  pointer: string
  file: string | undefined
  includedBy: NonNullable<Diagnostic['includedBy']>
}

function inclusionOf(frame: Frame): NonNullable<Diagnostic['includedBy']> {
  const chain: NonNullable<Diagnostic['includedBy']> = []
  for (let at = frame.above; at !== null; at = at.above) {
    if (at.node.type !== 'include' || at.node.children === undefined || at.node.pos === undefined) continue
    chain.push({ ...(at.file === undefined ? {} : { file: at.file }),
      range: { startOffset: at.node.pos.startOffset, endOffset: at.node.pos.endOffset } })
  }
  return chain.reverse()
}

/** The pointer and the file of each node of `wanted` that stands in the tree below `document`. */
function pointers(document: DocumentNode, wanted: Set<Node>): Map<Node, Place> {
  const found = new Map<Node, Place>()
  const stack: Frame[] = [{ node: document, above: null, step: '', file: undefined }]
  while (stack.length > 0 && found.size < wanted.size) {
    const frame = stack.pop()!
    if (wanted.has(frame.node)) found.set(frame.node, { pointer: pointerOf(frame), file: frame.file,
      includedBy: inclusionOf(frame) })
    pushSlots(stack, frame, document.extensions ?? [])
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
    const place = node === null ? undefined : found.get(node)
    entry.path = (place?.pointer ?? '') + (findings.steps?.get(entry) ?? '')
    const pos = place === undefined || node === null ? undefined : node.pos
    if (pos !== undefined && entry.range === undefined) entry.range = { startOffset: pos.startOffset, endOffset: pos.endOffset }
    // C2-N-063: the range is counted in the file of the node, which the include around it names.
    if (place?.file !== undefined) {
      entry.file = place.file
      if (place.includedBy.length > 0) entry.includedBy = place.includedBy
    }
  })
  return entries
}

const INDEX = /^(?:0|[1-9][0-9]*)$/

/**
 * C2-L-011 order of `path`: per node on the way down, 1, the rank of its slot and its index; a trailing 0
 * when the rest names a field of the last node, which so comes before the nodes in its slots.
 */
function pathKey(document: DocumentNode, path: string, declarations: readonly ExtensionDeclaration[]): number[] {
  const segments = path === '' ? [] : path.slice(1).split('/')
  const key: number[] = []
  let node: Node = document
  for (let at = 0; at < segments.length;) {
    let next: Node | undefined
    let used = 0
    let rank = 0
    let index = 0
    let slot = 0
    forEachSlot(node, (nodes, step, single) => {
      slot++
      if (next !== undefined) return
      const steps = step.split('/')
      for (let part = 0; part < steps.length; part++) if (segments[at + part] !== steps[part]) return
      const token = single ? '0' : segments[at + steps.length]
      if (token === undefined || !INDEX.test(token) || Number(token) >= nodes.length) return
      next = nodes[Number(token)]
      used = steps.length + (single ? 0 : 1)
      rank = slot
      index = Number(token)
    }, SOURCE_ORDER, declarations)
    if (next === undefined) {
      key.push(0)
      break
    }
    key.push(1, rank, index)
    node = next
    at += used
  }
  return key
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let at = 0; at < a.length && at < b.length; at++) if (a[at] !== b[at]) return a[at]! - b[at]!
  return a.length - b.length
}

/**
 * C2-W-158: the writer's entries on a supplied tree in document order of their paths (C2-L-011). Entries
 * the order does not decide (two fields of one node, one path) keep the order in which they were found.
 */
export function inDocumentOrder(document: DocumentNode, entries: Diagnostic[]): Diagnostic[] {
  if (entries.length < 2) return entries
  const declarations = document.extensions ?? []
  const keyed = entries.map((entry, at) => ({ entry, at, key: pathKey(document, entry.path ?? '', declarations) }))
  keyed.sort((a, b) => compareKeys(a.key, b.key) || a.at - b.at)
  return keyed.map(({ entry }) => entry)
}
