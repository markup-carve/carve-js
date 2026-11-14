// The canonical writer (spec/0.2/writer.md): a tree, and optionally the sidecar that was returned
// with it, as Carve source (C2-W-001). Blocks that a blank line separates are written and tested
// on their own (C2-W-089), so one block is written again only for its own escapes.
import { childNodes, type DocumentNode, forEachSlot, isRecord, type Node, pointerToken, SOURCE_ORDER, type TextNode } from './ast.ts'
import { treesEqual } from './ast-json.ts'
import { validateTree } from './ast-validate.ts'
import { type Diagnostic, locateFindings } from './diagnostics.ts'
import { blankLinesBetween, writeBlocks } from './write-blocks.ts'
import { type Check, compareBlocks, createCheck, escapeOpeners, extendChains, parseChunk } from './write-check.ts'
import { type Wrap } from './layout.ts'
import { isSecondHalf, unitBytes } from './positions.ts'
import { createWriter, lose, type Writer, type WriterFacts } from './write-state.ts'

/** One entry of a sidecar, as far as the writer reads it (C2-L-009, C2-L-046). */
export interface LayoutEntry extends WriterFacts {
  path: string
}

export interface WriteOptions {
  /** The sidecar of the tree (C2-L-004). Only its node entries are read. */
  layout?: { nodes: readonly LayoutEntry[] }
  /** C2-W-068: pads the cells of each column of a pipe table to one display width. */
  alignTables?: boolean
}

export interface WriteOutput {
  source: string
  /** C2-W-011: what the writer could not write, in the render-loss channel. */
  diagnostics: Diagnostic[]
}

/** Whether `value`, read at a pointer into a valid tree, is a node. */
function isNode(value: unknown): value is Node {
  return isRecord(value) && typeof value['type'] === 'string'
}

/** The node at the RFC 6901 pointer `path`, or null (C2-L-010). Each token is decoded: `~1` is `/`, `~0` is `~`. */
function nodeAt(document: DocumentNode, path: string): Node | null {
  let at: unknown = document
  for (const part of path.split('/').slice(1)) {
    if (typeof at !== 'object' || at === null) return null
    at = Reflect.get(at, pointerToken(part))
  }
  return isNode(at) ? at : null
}

/** How far the wraps of one text node have been read: a byte offset of its value and the string offset of it. */
interface WrapCursor {
  bytes: number
  at: number
  points: number[]
}

/** Moves `cursor` to the byte `offset` of `value`. False where no character starts there, or the offset lies behind. */
function seek(cursor: WrapCursor, value: string, offset: number): boolean {
  if (offset < cursor.bytes) return false
  while (cursor.bytes < offset && cursor.at < value.length) cursor.bytes += unitBytes(value, cursor.at++)
  return cursor.bytes === offset && !isSecondHalf(value, cursor.at)
}

/**
 * Whether the wrap at the byte `offset` of the text `node` fits the tree: a place behind the wraps
 * before it, with the joining space before it, or the start of the value (C2-L-021).
 */
function addWrap(cursor: WrapCursor, node: TextNode, offset: number): boolean {
  const value = node.value
  if (!seek(cursor, value, offset)) return false
  const last = cursor.points[cursor.points.length - 1] ?? 0
  const fits = cursor.at === 0 ? cursor.points.length === 0 : cursor.at > last && value[cursor.at - 1] === ' '
  if (fits) cursor.points.push(cursor.at)
  return fits
}

/**
 * C2-L-021: whether the wrap at offset 0 of the node at `path`, which is not text, can mark its start: it stands in the
 * content of `cell`, first or behind text that ends in the joining space.
 */
function startsFragment(document: DocumentNode, cell: Node, path: string): boolean {
  const cut = path.lastIndexOf('/children/')
  const parent = cut < 0 ? null : nodeAt(document, path.slice(0, cut))
  if (parent === null || parent !== childNodes(cell)[0]) return false
  const at = Number(path.slice(cut + '/children/'.length))
  if (at === 0) return true
  const before = childNodes(parent)[at - 1]
  return before?.type === 'text' && before.value.endsWith(' ')
}

/**
 * C2-L-020, C2-L-021: the places in the text nodes of a cell at which its continuation rows
 * start, and the nodes whose start is such a place. C2-L-006: a wrap that names no node of the
 * cell, or a place with no joining space before it, contradicts the tree, and then the cell keeps no wrap.
 */
function readWraps(w: Writer, facts: Map<Node, WriterFacts>, document: DocumentNode, cell: Node, entry: LayoutEntry): void {
  const cursors = new Map<TextNode, WrapCursor>()
  const starts = new Set<Node>()
  let path = ''
  let node: Node | null = null
  for (const wrap of entry.wraps ?? []) {
    // The wraps of one cell mostly name one text node, so its pointer is resolved once.
    if (wrap.path !== path || node === null) node = nodeAt(document, wrap.path)
    path = wrap.path
    if (node === null || !placeWrap(document, cell, node, wrap, cursors, starts)) {
      facts.set(cell, { ...entry, wraps: [] })
      return
    }
  }
  w.wrapPoints ??= new Map()
  for (const [text, cursor] of cursors) w.wrapPoints.set(text, cursor.points)
  w.wrapStarts ??= new Set()
  for (const start of starts) w.wrapStarts.add(start)
}

/** Records one wrap of a cell: a place in a text node, or the start of another node. False where it contradicts the tree. */
function placeWrap(
  document: DocumentNode, cell: Node, node: Node, wrap: Wrap, cursors: Map<TextNode, WrapCursor>, starts: Set<Node>,
): boolean {
  if (node.type !== 'text') {
    if (wrap.offset !== 0 || starts.has(node) || !startsFragment(document, cell, wrap.path)) return false
    starts.add(node)
    return true
  }
  const cursor = cursors.get(node) ?? { bytes: 0, at: 0, points: [] }
  if (!addWrap(cursor, node, wrap.offset)) return false
  cursors.set(node, cursor)
  return true
}

function readLayout(w: Writer, facts: Map<Node, WriterFacts>, document: DocumentNode, entries: readonly LayoutEntry[]): void {
  for (const entry of entries) {
    const node = nodeAt(document, entry.path)
    if (node === null) continue
    facts.set(node, entry)
    if (entry.wraps !== undefined && entry.wraps.length > 0) readWraps(w, facts, document, node, entry)
  }
}

/** C2-B-085: the first definition of a term wins. */
function readAbbreviations(w: Writer, document: DocumentNode): void {
  for (const child of document.children) {
    if (child.type === 'abbreviation_def' && !w.abbreviations.has(child.key)) w.abbreviations.set(child.key, child.expansion)
  }
}

/** Adds the escapes `added` to the ascending lists of their text nodes, one merge per node. */
function addEscapes(w: Writer, added: readonly [TextNode, number][]): void {
  const byNode = new Map<TextNode, number[]>()
  for (const [node, at] of added) {
    const list = byNode.get(node)
    if (list === undefined) byNode.set(node, [at])
    else list.push(at)
  }
  for (const [node, offsets] of byNode) {
    offsets.sort((a, b) => a - b)
    const list = w.escapes.get(node) ?? []
    const merged: number[] = []
    let i = 0
    for (const at of offsets) {
      while (i < list.length && list[i]! < at) merged.push(list[i++]!)
      merged.push(at)
    }
    while (i < list.length) merged.push(list[i++]!)
    w.escapes.set(node, merged)
  }
}

function removeEscape(w: Writer, node: TextNode, at: number): boolean {
  const list = w.escapes.get(node) ?? []
  const place = list.indexOf(at)
  if (place >= 0) list.splice(place, 1)
  return place >= 0
}

/** Takes over what a comparison asked for. Returns false where it asked for no change. */
function applyChanges(w: Writer, check: Check): boolean {
  // C2-W-091: the escapes are placed in the spelling of the nodes. Where a node first takes its other
  // form, the pass starts again in that spelling, so no escape of the old one stays.
  if (check.forms.some((node) => !w.forms.has(node))) {
    w.escapes.clear()
    w.attempts.clear()
    for (const node of check.forms) w.forms.set(node, (w.forms.get(node) ?? 0) + 1)
    return true
  }
  for (const [node, at] of check.retracted) removeEscape(w, node, at)
  addEscapes(w, check.escapes)
  for (const node of check.forms) w.forms.set(node, (w.forms.get(node) ?? 0) + 1)
  if (check.escapes.length + check.forms.length + check.retracted.length > 0) return true
  for (const [node, field] of check.losses) lose(w, node, field)
  return false
}

/** Whether `node` is written into one group with the block `before` above it. */
function joinsGroup(w: Writer, before: Node, node: Node): boolean {
  // C2-B-016: a description mark reads differently below a description list, also behind a blank line.
  if (node.type === 'paragraph') return before.type === 'definition_list'
  return node.type === 'comment' && blankLinesBetween(w, before, null, node, false) === 0
}

/**
 * The end of the group of blocks that starts at `from`: the blocks behind it that no blank line
 * separates from it, and what the block before reads differently.
 */
function groupEnd(w: Writer, nodes: readonly Node[], from: number): number {
  let end = from + 1
  while (end < nodes.length && joinsGroup(w, nodes[end - 1]!, nodes[end]!)) end++
  return end
}

/** The text nodes below `nodes` in the order in which they are written: a title before the children. */
function textOrder(nodes: readonly Node[], order: Map<Node, number>): Map<Node, number> {
  for (const node of nodes) {
    if (node.type === 'text') order.set(node, order.size)
    forEachSlot(node, (slot) => void textOrder(slot, order), SOURCE_ORDER)
  }
  return order
}

/**
 * C2-W-091: a round that asks for this many escapes or fewer places the first one only, since the
 * ones behind it were asked for with it not yet in place. A round that asks for more places them
 * all, so that the number of rounds stays linear in the size of the group.
 */
const MAX_ORDERED_ESCAPES = 4

/** C2-W-091: the first of `escapes` in written order. */
function leftmost(group: readonly Node[], escapes: readonly [TextNode, number][]): [TextNode, number] {
  const order = textOrder(group, new Map())
  let best = escapes[0]!
  for (const escape of escapes) {
    const rank = order.get(escape[0]) ?? -1
    const bestRank = order.get(best[0]) ?? -1
    if (rank < bestRank || (rank === bestRank && escape[1] < best[1])) best = escape
  }
  return best
}

/**
 * The escapes a round asked for behind the leftmost one wait for the next round (C2-W-091). A node
 * whose way to form asked for one of them takes that way again then, rather than its next one.
 */
function deferEscapes(w: Writer, deferred: readonly [TextNode, number][]): void {
  for (const attempt of w.attempts.values()) {
    const kept = attempt.escapes.filter((escape) => !deferred.includes(escape))
    if (kept.length === attempt.escapes.length) continue
    attempt.escapes = kept
    attempt.step--
  }
}

/** The tree of the group written with the escapes `escapes`. */
function groupTree(w: Writer, group: readonly Node[], first: boolean, escapes: Map<TextNode, number[]>): DocumentNode {
  w.escapes = escapes
  w.lines = []
  w.lead = null
  w.starts.clear()
  writeBlocks(w, group, '', 0, false)
  return parseChunk(`${first ? '' : '\n'}${w.lines.join('\n')}\n`, w.abbreviations)
}

/**
 * C2-W-088, C2-W-091: whether the test asks for the escape `at` of `node`: with the escapes to its
 * left in place and none to its right, the group parses to another tree without it.
 */
function isAsked(w: Writer, group: readonly Node[], first: boolean, node: TextNode, at: number): boolean {
  const placed = w.escapes
  const lines = w.lines
  const lead = w.lead
  const starts = new Map(w.starts)
  const order = textOrder(group, new Map())
  const rank = order.get(node) ?? -1
  const left = new Map<TextNode, number[]>()
  for (const [text, offsets] of placed) {
    const own = order.get(text) ?? -1
    if (own < rank) left.set(text, offsets)
    else if (text === node) left.set(text, offsets.filter((offset) => offset < at))
  }
  // Built before the first write, which may add the doubled backslash of C2-W-097 to the lists it reads.
  const escaped = new Map(left)
  escaped.set(node, [...(left.get(node) ?? []), at])
  const without = groupTree(w, group, first, left)
  const asked = !treesEqual(groupTree(w, group, first, escaped), without)
  w.escapes = placed
  w.lines = lines
  w.lead = lead
  w.starts.clear()
  for (const [key, value] of starts) w.starts.set(key, value)
  return asked
}

/**
 * One round of the test of C2-W-089 on the group `group`, which stands in `w.lines`. Returns
 * false when the group reads back as its blocks. C2-W-091: an escape stays once placed, and an
 * escape that a node which did not form asks for is placed only where the test asks for it.
 */
function settle(w: Writer, document: DocumentNode, group: readonly Node[], first: boolean): boolean {
  const check = compareGroup(w, document, group, first)
  let dropped = false
  // Each test writes the group twice; a round with more trials places them all, as it does escapes.
  const trials = check.trials.length <= MAX_ORDERED_ESCAPES ? check.trials : []
  for (const [node, at] of trials) {
    if (isAsked(w, group, first, node, at)) continue
    const place = check.escapes.findIndex((escape) => escape[0] === node && escape[1] === at)
    if (place >= 0) check.escapes.splice(place, 1)
    dropped = true
  }
  // The node that asked for a dropped escape takes its next way to form in the next round.
  if (dropped && check.escapes.length + check.forms.length + check.retracted.length === 0) return true
  if (check.escapes.length > 1 && check.escapes.length <= MAX_ORDERED_ESCAPES) {
    const first = leftmost(group, check.escapes)
    deferEscapes(w, check.escapes.filter((escape) => escape !== first))
    check.escapes = [first]
  }
  extendChains(check)
  const changes = check.escapes.length + check.forms.length + check.retracted.length
  if (changes === 0 && check.losses.length > 0 && first && !w.blankFirst) {
    // C2-W-005: what only line 1 reads differently is written below one blank line, and the
    // rounds go on there, since that line can still ask for escapes.
    w.blankFirst = compareGroup(w, document, group, false).losses.length === 0
    if (w.blankFirst) return true
  }
  return applyChanges(w, check)
}

/**
 * Writes the group of top-level blocks that starts at `from` into `w.lines` and returns its end.
 * C2-W-089: the group is parsed again and written again until it reads back as its blocks.
 * `first` says that the group starts the document, where line 1 can open frontmatter (C2-B-161).
 */
function writeGroup(w: Writer, document: DocumentNode, from: number, first: boolean): number {
  const nodes = document.children
  const reported = w.losses.entries.length
  for (;;) {
    const end = groupEnd(w, nodes, from)
    const group = nodes.slice(from, end)
    w.lines = []
    w.lead = null
    w.starts.clear()
    writeBlocks(w, group, '', 0, false)
    if (w.lines.length === 0) return end
    if (!settle(w, document, group, first && !w.blankFirst)) {
      if (w.losses.entries.length === reported) reportUnread(w, group)
      return end
    }
  }
}

/**
 * C2-W-002, C2-W-011: the finished group is compared with its blocks once more. A block that the
 * comparison of the rounds let pass and that reads back as another tree is reported as a loss, so
 * no output reads back differently without a report.
 */
function reportUnread(w: Writer, group: readonly Node[]): void {
  const parsed = w.parsed?.children ?? []
  for (let at = 0; at < Math.max(group.length, parsed.length); at++) {
    const block = parsed[at]
    if (block !== undefined && at < group.length && treesEqual(group[at]!, block)) continue
    lose(w, group[Math.min(at, group.length - 1)]!, null)
    return
  }
}

function compareGroup(w: Writer, document: DocumentNode, group: readonly Node[], first: boolean): Check {
  const source = `${first ? '' : '\n'}${w.lines.join('\n')}\n`
  const check = createCheck(w)
  check.source = source
  const parsed = parseChunk(source, w.abbreviations)
  w.parsed = parsed
  compareBlocks(check, group, parsed.children, document)
  escapeOpeners(check, parsed, first ? 1 : 2)
  return check
}

/** The last block of `nodes[from..to)` that is no comment, or `list` where all of them are comments. */
function lastBlock(nodes: readonly Node[], from: number, to: number, list: Node | null): Node | null {
  for (let at = to - 1; at >= from; at--) if (nodes[at]!.type !== 'comment') return nodes[at]!
  return list
}

function addLines(out: string[], lines: readonly string[], blanks: number): void {
  for (let blank = 0; blank < blanks; blank++) out.push('')
  for (const line of lines) out.push(line)
}

function writeDocument(w: Writer, document: DocumentNode): string {
  const nodes = document.children
  const out: string[] = []
  let before: Node | null = null
  let list: Node | null = null
  for (let at = 0; at < nodes.length;) {
    const from = at
    at = writeGroup(w, document, from, out.length === 0)
    if (w.lines.length === 0) continue
    if (out.length === 0 && w.blankFirst) out.push('')
    const blanks = before === null ? 0 : blankLinesBetween(w, before, list, nodes[from]!, false)
    addLines(out, w.lines, blanks)
    before = nodes[at - 1]!
    list = lastBlock(nodes, from, at, list)
  }
  // C2-W-022: the output ends with one line ending.
  return out.length === 0 ? '' : `${out.join('\n')}\n`
}

/** Writes a tree that is known to be valid. */
export function writeTree(document: DocumentNode, options: WriteOptions | undefined): WriteOutput {
  const layout = options?.layout
  const facts = layout === undefined ? null : new Map<Node, WriterFacts>()
  const w = createWriter(facts, options?.alignTables === true)
  if (layout !== undefined && facts !== null) readLayout(w, facts, document, layout.nodes)
  readAbbreviations(w, document)
  const source = writeDocument(w, document)
  // C2-W-103: a finding of the writer has the path of its node.
  return { source, diagnostics: locateFindings(document, w.losses) }
}

/** The canonical Carve source of a tree, with what could not be written (C2-W-011). The tree is validated first. */
export function writeWithDiagnostics(document: DocumentNode, options?: WriteOptions): WriteOutput {
  validateTree(document)
  return writeTree(document, options)
}

/** The canonical Carve source of a tree (C2-W-001). */
export function write(document: DocumentNode, options?: WriteOptions): string {
  return writeWithDiagnostics(document, options).source
}
