// The diagnostics record (C2-A-172, C2-A-173): its entries, and the position each one takes from the node it is about.
import { NODE_SLOTS } from './ast-tables.ts'
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

/** The node each located entry is about, its pointer, and its place in document order (C2-L-011). */
export type FindingOrder = Map<Diagnostic, FindingPlace>

interface FindingPlace {
  node: Node | null
  pointer: string
  ordinal: number
  /** The path the entry was given, and its part below the node. */
  path: string
  step: string
}

/** A node on the way down, with the step that leads to it from the node above. The pointer is spelled only for a node that is wanted. */
interface Frame {
  node: Node
  above: Frame | null
  step: string
  /** C2-N-053: the file of the node, the `file` of the nearest expanded include around it, or undefined for the top level. */
  file: string | undefined
  /** The nearest frame above of an expanded include with a position, which `includedBy` names. */
  include: Frame | null
  pointer: string | undefined
}

function pushList(stack: Frame[], list: readonly Node[] | undefined, above: Frame, slot: string, file: string | undefined,
  include: Frame | null): void {
  if (list === undefined) return
  for (let at = list.length - 1; at >= 0; at--) {
    stack.push({ node: list[at]!, above, step: `${slot}/${at}`, file, include, pointer: undefined })
  }
}

/** The fields that hold nodes (C2-A-024), and the columns of a table, which are nodes too. */
function pushSlots(stack: Frame[], frame: Frame, declarations: readonly ExtensionDeclaration[]): void {
  const node = frame.node
  const file = node.type === 'include' && node.children !== undefined ? node.file : frame.file
  const include = node.type === 'include' && node.children !== undefined && node.pos !== undefined ? frame : frame.include
  let count = 0
  forEachSlot(node, (nodes, step, single) => {
    slotLists[count] = nodes
    slotNames[count] = step
    slotSingle[count++] = single
  }, SOURCE_ORDER, declarations)
  // C2-L-011: the last slot goes on the stack first, so the walk visits the nodes in document order.
  for (let at = count - 1; at >= 0; at--) {
    const nodes = slotLists[at]!
    const step = slotNames[at]!
    if (slotSingle[at]) stack.push({ node: nodes[0]!, above: frame, step, file: frame.file, include, pointer: undefined })
    else pushList(stack, nodes, frame, step, step === 'children' ? file : frame.file, include)
  }
}

// The slots of the node `pushSlots` is at; reused, as the walk visits one node at a time.
const slotLists: (readonly Node[])[] = []
const slotNames: string[] = []
const slotSingle: boolean[] = []

/** The pointer of the node of `frame`: the steps from the document down to it. */
function pointerOf(frame: Frame): string {
  // Each frame keeps its pointer, so the pointers of nested wanted nodes share the work of their common part.
  const chain: Frame[] = []
  let at = frame
  while (at.above !== null && at.pointer === undefined) {
    chain.push(at)
    at = at.above
  }
  let pointer = at.pointer ?? ''
  for (let down = chain.length - 1; down >= 0; down--) {
    pointer = `${pointer}/${chain[down]!.step}`
    chain[down]!.pointer = pointer
  }
  return pointer
}

interface Place {
  pointer: string
  /** C2-L-011: the place of the node in document order. */
  ordinal: number
  file: string | undefined
  includedBy: NonNullable<Diagnostic['includedBy']>
}

function inclusionOf(frame: Frame): NonNullable<Diagnostic['includedBy']> {
  const chain: NonNullable<Diagnostic['includedBy']> = []
  for (let at = frame.include; at !== null; at = at.include) {
    const pos = at.node.pos!
    chain.push({ ...(at.file === undefined ? {} : { file: at.file }),
      range: { startOffset: pos.startOffset, endOffset: pos.endOffset } })
  }
  return chain.reverse()
}

/** The pointer and the file of each node of `wanted` that stands in the tree below `document`. */
function pointers(document: DocumentNode, wanted: Set<Node>): Map<Node, Place> {
  const found = new Map<Node, Place>()
  const stack: Frame[] = [{ node: document, above: null, step: '', file: undefined, include: null, pointer: undefined }]
  let ordinal = 0
  while (stack.length > 0 && found.size < wanted.size) {
    const frame = stack.pop()!
    if (wanted.has(frame.node)) found.set(frame.node, { pointer: pointerOf(frame), ordinal, file: frame.file,
      includedBy: inclusionOf(frame) })
    ordinal++
    pushSlots(stack, frame, document.extensions ?? [])
  }
  return found
}

/**
 * C2-A-173: gives every entry its position: the pointer of its node, and the byte range of that
 * node where it has one. An entry about the document, or about a node that is not in the tree,
 * points at the document. The tree is walked once, and only when there is an entry.
 */
export function locateFindings(document: DocumentNode, findings: Findings, order?: FindingOrder): Diagnostic[] {
  const { entries, nodes } = findings
  if (entries.length === 0) return entries
  const wanted = new Set<Node>()
  for (const node of nodes) if (node !== null) wanted.add(node)
  const found = pointers(document, wanted)
  entries.forEach((entry, at) => {
    const node = nodes[at] ?? null
    const place = node === null ? undefined : found.get(node)
    const step = findings.steps?.get(entry) ?? ''
    entry.path = (place?.pointer ?? '') + step
    if (place !== undefined) placeEntry(entry, node!, place)
    order?.set(entry, place === undefined ? { node: null, pointer: '', ordinal: 0, path: entry.path, step }
      : { node, pointer: place.pointer, ordinal: place.ordinal, path: entry.path, step })
  })
  return entries
}

function placeEntry(entry: Diagnostic, node: Node, place: Place): void {
  const pos = node.pos
  if (pos !== undefined && entry.range === undefined) entry.range = { startOffset: pos.startOffset, endOffset: pos.endOffset }
  // C2-N-063: the range is counted in the file of the node, which the include around it names.
  if (place.file !== undefined) {
    entry.file = place.file
    if (place.includedBy.length > 0) entry.includedBy = place.includedBy
  }
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
    const step = slotStep(node, segments, at, declarations)
    if (step === undefined) {
      key.push(0)
      break
    }
    key.push(1, step.rank, step.index)
    node = step.next
    at += step.used
  }
  return key
}

/** The node below `node` that `segments` name from `at` on, or undefined when they name a field of `node`. */
function slotStep(node: Node, segments: readonly string[], at: number, declarations: readonly ExtensionDeclaration[]):
  { next: Node, used: number, rank: number, index: number } | undefined {
  let found: { next: Node, used: number, rank: number, index: number } | undefined
  let slot = 0
  forEachSlot(node, (nodes, step, single) => {
    slot++
    if (found !== undefined) return
    const steps = step.split('/')
    for (let part = 0; part < steps.length; part++) if (segments[at + part] !== steps[part]) return
    const token = single ? '0' : segments[at + steps.length]
    if (token === undefined || !INDEX.test(token) || Number(token) >= nodes.length) return
    found = { next: nodes[Number(token)]!, used: steps.length + (single ? 0 : 1), rank: slot, index: Number(token) }
  }, SOURCE_ORDER, declarations)
  return found
}

/**
 * The document-order keys of `entries` from the places their nodes were located at: twice the place, plus one
 * for a field of the node. Null when a path is not its node's pointer, or that pointer and a field of the node.
 */
function placedKeys(document: DocumentNode, entries: readonly Diagnostic[], order: FindingOrder,
  declarations: readonly ExtensionDeclaration[]): number[] | null {
  const keys: number[] = []
  for (const entry of entries) {
    const key = placedKey(document, entry, order.get(entry), declarations)
    if (key === null) return null
    keys.push(key)
  }
  return keys
}

function placedKey(document: DocumentNode, entry: Diagnostic, place: FindingPlace | undefined,
  declarations: readonly ExtensionDeclaration[]): number | null {
  const path = entry.path ?? ''
  const pointer = place?.pointer ?? ''
  const ordinal = place?.ordinal ?? 0
  // A path left as located is compared by identity: pointers of nested nodes are long, and reading them is quadratic.
  let rest: string
  if (place !== undefined && path === place.path) rest = place.step
  else if (path.startsWith(pointer)) rest = path.slice(pointer.length)
  else return null
  if (rest === '') return 2 * ordinal
  if (rest[0] !== '/') return null
  const node = place?.node ?? document
  if (startsSlot(rest, node.type) && slotStep(node, rest.slice(1).split('/'), 0, declarations) !== undefined) return null
  return 2 * ordinal + 1
}

const SLOT_HEADS = new Map<string, readonly string[]>()

/** Whether `rest` starts with the first segment of a slot a node of `type` can have; otherwise it names a field. */
function startsSlot(rest: string, type: string): boolean {
  let heads = SLOT_HEADS.get(type)
  if (heads === undefined) {
    SLOT_HEADS.set(type, heads = [...new Set((NODE_SLOTS.get(type) ?? []).map((path) => `/${path.split('.')[0]!}`))])
  }
  for (const head of heads) {
    if (rest.startsWith(head) && (rest.length === head.length || rest.charCodeAt(head.length) === 0x2f)) return true
  }
  return false
}

function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let at = 0; at < a.length && at < b.length; at++) if (a[at] !== b[at]) return a[at]! - b[at]!
  return a.length - b.length
}

/**
 * C2-W-158: the writer's entries on a supplied tree in document order of their paths (C2-L-011). Entries
 * the order does not decide (two fields of one node, one path) keep the order in which they were found.
 */
export function inDocumentOrder(document: DocumentNode, entries: Diagnostic[], order?: FindingOrder): Diagnostic[] {
  if (entries.length < 2) return entries
  const declarations = document.extensions ?? []
  const placed = order === undefined ? null : placedKeys(document, entries, order, declarations)
  if (placed !== null) {
    const at = entries.map((_, index) => index)
    at.sort((a, b) => placed[a]! - placed[b]! || a - b)
    return at.map((index) => entries[index]!)
  }
  const keyed = entries.map((entry, at) => ({ entry, at, key: pathKey(document, entry.path ?? '', declarations) }))
  keyed.sort((a, b) => compareKeys(a.key, b.key) || a.at - b.at)
  return keyed.map(({ entry }) => entry)
}
