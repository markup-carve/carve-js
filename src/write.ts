// The canonical writer (spec/0.2/writer.md): a tree, and optionally the sidecar that was returned
// with it, as Carve source (C2-W-001). Blocks that a blank line separates are written and tested
// on their own (C2-W-089), so one block is written again only for its own escapes.
import {
  childNodes, type CommentNode, type DocumentNode, forEachSlot, isRecord, type Node, pointerToken, SOURCE_ORDER, type TextNode,
} from './ast.ts'
import { treesEqual } from './ast-json.ts'
import { beyondParserLevels, nodeLevels, validateTree } from './ast-validate.ts'
import { addFinding, type Diagnostic, locateFindings } from './diagnostics.ts'
import { blankLinesBetween, commentLinesEnd, followingAttributes, followsContainerDirectly, writeBlocks } from './write-blocks.ts'
import { addSpanMarks } from './write-spans.ts'
import { tableFormat } from './write-table.ts'
import { trimLineEnds } from './write-trim.ts'
import { type Asked, EARLY_FINAL, EARLY_PAIRS, LATE_PAIRS, NO_PAIRS, pairEscapes, pairReach } from './write-pairs.ts'
import { escapeKinds, escapePartnerClosers, leavesKindBare } from './write-kinds.ts'
import {
  type Check, compareBlocks, createCheck, escapeOpeners, exhausted, extendChains, openerOffsets, parseChunk, parseWritten,
} from './write-check.ts'
import { type Wrap } from './layout.ts'
import { isSecondHalf, unitBytes, utf8Length } from './positions.ts'
import { createWriter, type LossMark, lose, markLosses, rollBackLosses, type Writer, type WriterFacts } from './write-state.ts'
import { createPlan, notePlaces, type Plan } from './write-plan.ts'
import { plainParagraph } from './write-plain.ts'
import { type ExtensionDefinition } from './extensions/types.ts'
import { sourceCoreEquivalent, withCoreInlines } from './write-extension-source.ts'

/** One entry of a sidecar, as far as the writer reads it (C2-L-009, C2-L-046). */
export interface LayoutEntry extends WriterFacts {
  path: string
}

export interface WriteOptions {
  extensions?: readonly ExtensionDefinition[]
  /** The sidecar of the tree (C2-L-004). Its node entries are read, and its source for C2-W-144. */
  layout?: { nodes: readonly LayoutEntry[], source?: string, encoding?: string }
  /** C2-W-068: pads the cells of each column of a pipe table to one display width. */
  alignTables?: boolean
  /**
   * C2-W-002: parses each written group of blocks once more and compares it with the tree. A group
   * that does not read back is written again by the repair of C2-W-089. On for `write` and
   * `writeWithDiagnostics` unless it is `false`; `format` writes the tree of its own parse with it off.
   */
  check?: boolean
}

/** How the writer finds its escapes: by the plan (write-plan.ts), by the repair, or both, comparing them. */
export type WriterPath = 'plan' | 'repair' | 'both'

/** What a write reports about its own path, for the tests and the gates. */
export interface WriterStats {
  planned: number
  repaired: number
  /** Groups whose plan and repair wrote different lines, in `both`. */
  differences: string[]
  /** Why each group the plan did not decide was repaired, by reason, and one place of each reason. */
  reasons: Map<string, number>
  samples: Map<string, string>
  parses: number
  /** The characters of each repaired group and the characters its repair parsed. */
  work: [number, number][]
}

interface WriterRun {
  path: WriterPath
  check: boolean
  stats: WriterStats
}

export interface WriteOutput {
  source: string
  /** C2-W-011: what the writer could not write, in the render-loss channel. */
  diagnostics: Diagnostic[]
}

/** C2-W-133, C2-W-134: a source-only writer cannot return a result that needs a loss report. */
export class CarveWriteError extends Error {
  readonly diagnostics: readonly Diagnostic[]

  constructor(diagnostics: readonly Diagnostic[]) {
    super('the writer cannot return this source without a loss report')
    this.name = 'CarveWriteError'
    this.diagnostics = diagnostics
  }
}

/** C2-W-133, C2-W-134: losses that a source-only writer cannot return silently. */
export function writerHasLoss(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((entry) => entry.code === 'writer-refused' || entry.code === 'structure-unspellable' ||
    entry.code === 'field-unspellable')
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

/** A wrapper whose only written content is one plain line-feed text. */
function onlyLineFeedLeaf(wrapper: Node): TextNode | null {
  if (wrapper.type === 'document' && wrapper.children.length !== 1) return null
  let at = wrapper
  while (at.type !== 'text') {
    if (!['document', 'paragraph', 'line', 'line_block'].includes(at.type)) return null
    if (Object.keys(at).some(key => !['type', 'children', 'pos', 'astVersion'].includes(key))) return null
    const children = childNodes(at)
    if (children.length !== 1) return null
    at = children[0]!
  }
  if (Object.keys(at).some(key => !['type', 'value', 'pos'].includes(key))) return null
  return at.value.trim() === '' ? null : at
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

function ascending(offsets: readonly number[]): boolean {
  for (let at = 1; at < offsets.length; at++) if (offsets[at - 1]! > offsets[at]!) return false
  return true
}

/** C2-W-146: adds the pair escapes `asked` to the ascending lists of their text nodes. */
function addAsked(w: Writer, asked: Asked): void {
  for (const [node, offsets] of asked) {
    if (!ascending(offsets)) offsets.sort((a, b) => a - b)
    const list = w.escapes.get(node)
    if (list === undefined || list.length === 0) {
      w.escapes.set(node, offsets)
      continue
    }
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
  for (const [node] of check.losses) refuseLeafLines(w, node, 0)
  for (const [node, field] of check.losses) lose(w, node, field)
  return false
}

// C2-W-016: the inline leaves whose later lines are lines of the leaf.
const LINE_LEAVES: readonly string[] = ['code', 'literal_inline', 'math', 'raw_inline', 'comment', 'critic_comment']

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/** Whether a line of `value` after the first starts as a block opener can: with a mark, or a number before `.` or `)`. */
function hasOpenerLine(value: string): boolean {
  for (let at = value.indexOf('\n'); at >= 0; at = value.indexOf('\n', at + 1)) {
    let start = at + 1
    while (value[start] === ' ' || value[start] === '\t') start++
    if (start >= value.length || value[start] === '\n') continue
    if (!isAsciiAlphanumeric(value.charCodeAt(start))) return true
    let end = start
    while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
    if (value[end] === '.' || value[end] === ')') return true
  }
  return false
}

/**
 * C2-W-016: a lost inline node holds a leaf whose later line would open a block. No spelling keeps
 * that value, so the leaf is refused with `field-unspellable`.
 */
function refuseLeafLines(w: Writer, node: Node, depth: number): void {
  if (depth > MAX_LEAF_DEPTH || node.type === 'paragraph' || node.type === 'list_item') return
  if (LINE_LEAVES.includes(node.type)) {
    const value = 'value' in node && typeof node.value === 'string' ? node.value : ''
    if (hasOpenerLine(value)) lose(w, node, 'value')
    return
  }
  for (const child of childNodes(node)) refuseLeafLines(w, child, depth + 1)
}

/** Whether `node` is written into one group with the block `before` above it. */
function joinsGroup(w: Writer, before: Node, node: Node): boolean {
  // C2-B-016: a description mark reads differently below a description list, also behind a blank line.
  if (node.type === 'paragraph') return before.type === 'definition_list' || followsContainerDirectly(w, before, node)
  return node.type === 'comment' && blankLinesBetween(w, before, null, node, false) === 0
}

/**
 * The end of the group of blocks that starts at `from`: the blocks behind it that no blank line
 * separates from it, and what the block before reads differently.
 */
// `prior` is the block before `at` behind its comments, and `following` the block after the comment lines behind `at`.
function isBridged(w: Writer, nodes: readonly Node[], prior: Node | undefined, at: number, following: Node | undefined): boolean {
  if (prior?.type !== 'list' && prior?.type !== 'definition_list' && prior?.type !== 'footnote') return false
  const node = nodes[at]
  return followingAttributes(w, node?.type === 'comment' ? following : node) !== ''
}

function groupEnd(w: Writer, nodes: readonly Node[], from: number): number {
  let end = from + 1
  // The last block of the group that is no comment, and the first block behind the comment lines after `end`: kept
  // as the group grows, so a run of comments is walked once rather than once per comment.
  let priorAt = nodes[from]?.type === 'comment' ? from - 1 : from
  let after = -1
  while (end < nodes.length) {
    const before = nodes[end - 1]!
    const node = nodes[end]!
    if (after <= end) after = commentLinesEnd(nodes, end)
    const bridged = isBridged(w, nodes, nodes[priorAt], end, nodes[after])
    const hoisted = node.type === 'comment' && bridged
    const belongs = before.type === 'comment' && bridged
    if (!hoisted && !belongs && !joinsGroup(w, before, node)) break
    if (node.type !== 'comment') priorAt = end
    end++
  }
  return end
}

// The nesting of inline nodes stays under the depth cap of the parser.
const MAX_LEAF_DEPTH = 200

/** Text nodes in source order, so a trial sees the escapes already placed to its left. */
function textOrder(nodes: readonly Node[], order: Map<Node, number>): Map<Node, number> {
  for (const node of nodes) {
    if (node.type === 'text') order.set(node, order.size)
    forEachSlot(node, (slot) => void textOrder(slot, order), SOURCE_ORDER)
  }
  return order
}

/** Parse a C2-W-125 trial with one candidate escape in the current group spelling. */
function groupTree(w: Writer, group: readonly Node[], first: boolean, escapes: Map<TextNode, number[]>): DocumentNode {
  w.escapes = escapes
  w.lines = []
  w.lead = null
  w.starts.clear()
  writeBlocks(w, group, '', 0, false)
  return parseChunk(w, `${first ? '' : '\n'}${w.lines.join('\n')}\n`)
}

/** Whether a trial escape changes the tree with earlier escapes in place. */
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

/** C2-W-088: a lone backtick trial that the test kept stopped a code span of the parse, which reports the backtick kind. */
function keepCodeTrial(check: Check): void {
  const trial = check.trials[0]
  if (check.trials.length === 1 && trial !== undefined && check.codeTrials.has(trial) && check.escapes.includes(trial)) check.trials = []
}

/**
 * One round of the test of C2-W-089 on the group `group`, which stands in `w.lines`. Returns
 * false when the group reads back as its blocks. C2-W-088 places all escapes reported by the same read-back parse.
 */
function settle(w: Writer, document: DocumentNode, group: readonly Node[], first: boolean): boolean {
  const check = compareGroup(w, document, group, first)
  // C2-W-125 tries to form a missing node separately from the constructs C2-W-088 found in the
  // read-back parse. A lone ineffective trial takes no escape. Multiple trials can work together.
  let dropped = false
  for (const [node, at] of check.trials.length <= 4 ? check.trials : []) {
    if (check.trials.length > 1) continue
    if (isAsked(w, group, first, node, at)) continue
    const place = check.escapes.findIndex((escape) => escape[0] === node && escape[1] === at)
    if (place >= 0) check.escapes.splice(place, 1)
    dropped = true
  }
  if (dropped && check.escapes.length + check.forms.length + check.retracted.length === 0) return true
  keepCodeTrial(check)
  dropLineDuplicates(check)
  if (w.kindRounds) {
    escapeKinds(check, group)
    escapePartnerClosers(check, group)
  }
  extendChains(check)
  extendForms(w, check, group)
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
 * C2-W-075: a reference whose recorded text did not read back is written from the tree, and so is each reference of
 * the group recorded with the same text, so the rounds do not grow with the number of such references.
 */
function extendForms(w: Writer, check: Check, group: readonly Node[]): void {
  const texts = new Set<string>()
  for (const node of check.forms) {
    const raw = recordedReference(w, node)
    if (raw !== undefined) texts.add(raw)
  }
  if (texts.size === 0) return
  const asked = new Set(check.forms)
  const pending = [...group]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const raw = asked.has(node) || (w.forms.get(node) ?? 0) > 0 ? undefined : recordedReference(w, node)
    if (raw !== undefined && texts.has(raw)) {
      check.forms.push(node)
      asked.add(node)
    }
    forEachSlot(node, (children) => { for (const child of children) pending.push(child) })
  }
}

function recordedReference(w: Writer, node: Node): string | undefined {
  return 'key' in node && node.key !== undefined ? w.facts?.get(node)?.rawRef : undefined
}

/**
 * C2-W-092, C2-W-152: a line whose opener this round escapes takes no second backslash on that opener, from a
 * C2-W-125 trial or from the column of the block the parse opened there.
 */
function dropLineDuplicates(check: Check): void {
  if (check.lineEscapes.size === 0) return
  const trials = new Set(check.trials)
  for (let place = check.escapes.length - 1; place >= 0; place--) {
    const escape = check.escapes[place]!
    const [node, at] = escape
    const line = check.lineEscapes.get(node)
    if (line === undefined || line.has(at) || !openerOffsets(node.value).includes(at)) continue
    if (trials.has(escape) || check.ownEscapes.get(node)?.has(at) === true) check.escapes.splice(place, 1)
  }
}

function nodeId(ids: Map<Node, number>, node: Node): number {
  const known = ids.get(node)
  if (known !== undefined) return known
  const id = ids.size
  ids.set(node, id)
  return id
}

/** C2-W-133: the repair state of this group, including attempts that can change its next round. */
function repairKey(w: Writer, ids: Map<Node, number>, group: readonly Node[]): string {
  const states: unknown[] = []
  const pending = [...group]
  for (;;) {
    const node = pending.pop()
    if (node === undefined) break
    const attempt = w.attempts.get(node)
    states.push([nodeId(ids, node), node.type === 'text' ? w.escapes.get(node) : undefined,
      w.forms.get(node), attempt?.step,
      attempt?.escapes.map(([text, at]) => [nodeId(ids, text), at]), w.lost.has(node)])
    forEachSlot(node, (children) => { for (const child of children) pending.push(child) })
  }
  return JSON.stringify([w.lines, w.blankFirst, w.losses.entries.length, states])
}

/** C2-W-133: report a repair loop or exhausted search as a refusal, with the group's path. */
function refuseRepair(w: Writer, node: Node): void {
  addFinding(w.losses, node, {
    code: 'writer-refused', severity: 'warning', channel: 'render-loss',
    message: 'the writer could not complete its repair for this block',
  })
}

interface RepairHistory {
  ids: Map<Node, number>
  recent: string[]
  seen: Set<string>
  rounds: number
  /** The budget of the document when this repair started (C2-W-133). */
  budget: number
}
// C2-W-133: the parses of all repairs, their probes included, read at most this many characters per character of
// the document, or the floor for a short one, so the repairs take time linear in the document however many groups
// it has. The floor is above the 20 million characters that the slowest of 20,000 property documents needs (four
// kilobytes of unclosed braced openers past the depth cap).
const WORK_FACTOR = 1000
const WORK_FLOOR = 24_000_000

/** C2-W-133: stop a repeated repair state or an exhausted repair budget. */
function repeatedRepair(w: Writer, group: readonly Node[], history: RepairHistory): boolean {
  const chars = w.lines.reduce((total, line) => total + line.length + 1, 0)
  let spent = false
  if (history.rounds === 0) {
    history.budget = Math.max(WORK_FLOOR, Math.max(w.work.source, w.work.written + chars) * WORK_FACTOR)
    w.work.limit = w.work.chars + history.budget - w.work.spent
    spent = w.work.spent >= history.budget
  }
  history.rounds++
  // The writes of the rounds draw on a pool of the same size, so a round whose parse is cached still counts.
  w.work.rewritten += chars
  if (spent || history.rounds > 8192 || w.work.rewritten > history.budget || exhausted(w)) {
    const host = group[0]
    if (host !== undefined) refuseRepair(w, host)
    return true
  }
  const key = repairKey(w, history.ids, group)
  if (history.seen.has(key)) {
    const host = group[0]
    if (host !== undefined) refuseRepair(w, host)
    return true
  }
  history.recent.push(key)
  history.seen.add(key)
  if (history.recent.length > 16) {
    const old = history.recent.shift()
    if (old !== undefined) history.seen.delete(old)
  }
  return false
}

function resetLines(w: Writer): void {
  w.lines = []
  w.lead = null
  w.bareDotLead = null
  w.prewrittenAttributes = null
  w.starts.clear()
}

function noteReason(run: WriterRun, why: string, detail: string): void {
  run.stats.reasons.set(why, (run.stats.reasons.get(why) ?? 0) + 1)
  if (!run.stats.samples.has(why)) run.stats.samples.set(why, detail)
}

/**
 * Adds the planned escapes to those of `w` in place and returns what they replaced. Copying the map of the
 * whole document for each group made the writer quadratic in the number of groups.
 */
function addPlanned(w: Writer, plan: Plan): [TextNode, number[] | undefined][] {
  const replaced: [TextNode, number[] | undefined][] = []
  for (const [node, offsets] of plan.escapes) {
    const previous = w.escapes.get(node)
    replaced.push([node, previous])
    w.escapes.set(node, [...new Set([...(previous ?? []), ...offsets])].sort((a, b) => a - b))
  }
  return replaced
}

function restoreEscapes(w: Writer, replaced: readonly [TextNode, number[] | undefined][]): void {
  for (const [node, previous] of replaced) {
    if (previous === undefined) w.escapes.delete(node)
    else w.escapes.set(node, previous)
  }
}

/** The text nodes below `nodes` that no planned leaf held. */
function uncovered(nodes: readonly Node[], plan: Plan): boolean {
  const pending = [...nodes]
  for (;;) {
    const node = pending.pop()
    if (node === undefined) return false
    if (plan.opaqueBlocks.has(node)) continue
    if (node.type === 'text' && !plan.covered.has(node)) return true
    forEachSlot(node, (children) => { for (const child of children) pending.push(child) })
  }
}

/** Whether only spaces and tabs follow the last CR of `line`; a lone CR before other content is no line end (C2-B-010). */
function endsWithCr(line: string): boolean {
  let at = line.length - 1
  while (at >= 0 && (line.charCodeAt(at) === 32 || line.charCodeAt(at) === 9)) at--
  return at >= 0 && line.charCodeAt(at) === 13
}

function countCrEnds(lines: readonly string[]): number {
  let count = 0
  for (const line of lines) if (endsWithCr(line)) count++
  return count
}

/** The reason the plan of a group has no decision, or null. */
function planReason(w: Writer, group: readonly Node[], plan: Plan, reported: number): string | null {
  if (plan.undecided !== null) return plan.undecided
  if (w.losses.entries.length !== reported) return 'loss'
  // C2-W-016, C2-B-010: a CR that only spaces and tabs follow on its line, in a block value as in an inline, joins the line end.
  if (plan.lost.length < w.lines.length && countCrEnds(w.lines) > plan.lost.length) return 'control'
  return uncovered(group, plan) ? 'coverage' : null
}

function withoutStandardData(node: Node): Node {
  const copy = structuredClone(node)
  const visit = (item: Node): void => {
    if (isRecord(item.data)) {
      const kept = Object.entries(item.data).filter(([key]) =>
        key !== 'carve.source' && key !== 'carve.style' && key !== 'carve.annotation')
      if (kept.length === 0) delete item.data
      else item.data = Object.fromEntries(kept)
    }
    forEachSlot(item, (children) => { for (const child of children) visit(child) })
  }
  visit(copy)
  return copy
}

/** Whether `withoutStandardData` or `withCoreInlines` can change `tree`: a data record or an inline extension in it. */
function holdsRewrites(tree: Node): boolean {
  const pending: object[] = [tree]
  for (let value = pending.pop(); value !== undefined; value = pending.pop()) {
    if (!Array.isArray(value)) {
      const record = value as Record<string, unknown>
      if (record['type'] === 'inline_extension' || isRecord(record['data'])) return true
    }
    for (const item of Object.values(value) as unknown[]) if (typeof item === 'object' && item !== null) pending.push(item)
  }
  return false
}

/** C2-W-002, C2-A-193: the writer disregards standard data namespaces in its readback check. */
function writerEqual(expected: Node, actual: Node): boolean {
  if (treesEqual(expected, actual) || sourceCoreEquivalent(expected, actual)) return true
  if (!holdsRewrites(expected)) return false
  const plain = withoutStandardData(expected)
  if (treesEqual(plain, actual)) return true
  const cores = withCoreInlines(plain)
  return cores !== undefined && treesEqual(cores, actual)
}

/** C2-W-002: whether the written group reads back as its blocks. */
function readsBack(w: Writer, group: readonly Node[], first: boolean): boolean {
  if (group.length === 1 && w.extensions.length === 0 && w.abbreviations.size === 0) {
    const plain = plainParagraph(w.lines)
    if (plain !== null && writerEqual(group[0]!, plain)) return true
  }
  // Equality disregards positions (C2-A-161), so the readback builds none.
  const parsed = parseChunk(w, `${first ? '' : '\n'}${w.lines.join('\n')}\n`, w.linkKeys, false).children
  return parsed.length === group.length && parsed.every((node, at) => writerEqual(group[at]!, node))
}

/**
 * Writes the group by its plan (write-plan.ts): the blocks are written once with the planner on,
 * and once more with the planned escapes. Returns false, with `w` as before but for what the
 * first write of the repair would have done too, where the plan does not decide the group.
 */
/** One planned write of the group. */
function planWrite(w: Writer, group: readonly Node[], first: boolean): Plan {
  resetLines(w)
  w.plan = createPlan()
  notePlaces(w.plan, group, first)
  writeBlocks(w, group, '', 0, false)
  const plan = w.plan
  w.plan = null
  return plan
}

// C2-W-069: each round gives more nodes their braced form, so a few rounds settle a group.
const MAX_PLAN_ROUNDS = 4

/** The plan of the group, with the braced forms it asks for in place. Null where it decides nothing. */
function settledPlan(w: Writer, run: WriterRun, group: readonly Node[], first: boolean, reported: number): Plan | null {
  const respelled: Node[] = []
  for (let round = 0; round < MAX_PLAN_ROUNDS; round++) {
    const plan = planWrite(w, group, first)
    const why = planReason(w, group, plan, reported)
    if (why === null && plan.respell.length === 0) return plan
    w.planWhy = why
    if (why !== null || round === MAX_PLAN_ROUNDS - 1) {
      noteReason(run, why ?? 'respell rounds', plan.detail)
      break
    }
    for (const node of plan.respell) {
      w.forms.set(node, 1)
      respelled.push(node)
    }
  }
  for (const node of respelled) w.forms.delete(node)
  return null
}

/** C2-W-146 for one group: whether its pair escapes are still to be tested after its write, and whether they were. */
interface GroupPairs {
  late: boolean
  settled: boolean
  /** For EARLY_FINAL, the escapes right after the early ones: while they stand, the test after the write finds nothing. */
  final: Map<TextNode, number[]> | null
}

function sameEscapes(escapes: ReadonlyMap<TextNode, readonly number[]>, final: ReadonlyMap<TextNode, readonly number[]>): boolean {
  if (escapes.size !== final.size) return false
  for (const [node, offsets] of escapes) {
    const kept = final.get(node)
    if (kept === undefined || kept.length !== offsets.length) return false
    for (let at = 0; at < offsets.length; at++) if (kept[at] !== offsets[at]) return false
  }
  return true
}

function planGroup(w: Writer, run: WriterRun, group: readonly Node[], first: boolean, pairs: GroupPairs): boolean {
  const reported = w.losses.entries.length
  const plan = settledPlan(w, run, group, first, reported)
  if (plan === null) return false
  const replaced = addPlanned(w, plan)
  if (leavesKind(w, run, group, plan, replaced)) return false
  if (replaced.length > 0) {
    resetLines(w)
    writeBlocks(w, group, '', 0, false)
  }
  // C2-W-016: a CR at a line end has no spelling; the group is reported and does not read back.
  for (const node of plan.lost) lose(w, node, 'value')
  const checked = run.check && plan.lost.length === 0 && w.lines.length > 0
  // The pair test reads its own spelling back, also where the run checks nothing, as the repair it replaces does.
  const placed = pairs.late && plan.lost.length === 0 && w.lines.length > 0 && run.path === 'plan'
    ? testLatePairs(w, group, first, pairs) : REFUSED
  if (placed === PLACED) {
    // C2-W-089: the plan alone did not decide a group that needed a pair round and its parse.
    run.stats.repaired++
    pairs.settled = true
    return true
  }
  if (checked && !readsBack(w, group, first)) {
    restoreEscapes(w, replaced)
    noteReason(run, 'check', '')
    return false
  }
  // The pair rules asked nothing of the planned spelling, so the test after the write would find nothing either.
  if (placed === NONE_ASKED) pairs.settled = true
  return true
}

/** C2-W-088: a round escapes every opener of a kind its parse reports; a plan that leaves one bare goes to the rounds. */
function leavesKind(w: Writer, run: WriterRun, group: readonly Node[], plan: Plan,
  replaced: readonly [TextNode, number[] | undefined][]): boolean {
  if (!w.kindRounds || w.planKinds || plan.escapes.size === 0 || !leavesKindBare(group, plan.escapes, w.escapes)) return false
  restoreEscapes(w, replaced)
  noteReason(run, 'kind', '')
  w.planWhy = 'kind'
  return true
}

const REFUSED = 0
const PLACED = 1
const NONE_ASKED = 2

/** `placeLatePairs`, where the early escapes still stand as they were proven final, asks nothing. */
function testLatePairs(w: Writer, group: readonly Node[], first: boolean, pairs: GroupPairs): number {
  return pairs.final !== null && sameEscapes(w.escapes, pairs.final) ? NONE_ASKED : placeLatePairs(w, group, first)
}

/**
 * C2-W-146: the pair escapes of a planned group are placed before its readback, so the one readback of the plan
 * checks the final spelling. Returns REFUSED, with `w` as before, where the repair would treat the group otherwise:
 * a round that reports a loss, a spelling that does not read back, or escapes the repair could prune.
 */
function placeLatePairs(w: Writer, group: readonly Node[], first: boolean): number {
  let asked = pairEscapes(group, w.escapes)
  if (asked.size === 0) return NONE_ASKED
  const escapes = new Map(w.escapes)
  const mark = markLosses(w)
  for (let round = 0; round < MAX_PAIR_ROUNDS && asked.size > 0; round++) {
    addAsked(w, asked)
    resetLines(w)
    writeBlocks(w, group, '', 0, false)
    if (w.losses.entries.length > mark.entries) break
    asked = pairEscapes(group, w.escapes)
  }
  if (asked.size === 0 && w.losses.entries.length === mark.entries && !mayPrune(w.lines, group) &&
    !beyondSourceDepth(group) && readsBack(w, group, first)) return PLACED
  w.escapes = escapes
  rollBackLosses(w, mark)
  resetLines(w)
  writeBlocks(w, group, '', 0, false)
  return REFUSED
}

/** Whether the written group holds a backslash that `prunableOpener` can take, which only the repair prunes. */
function mayPrune(lines: readonly string[], group: readonly Node[]): boolean {
  let breaks: boolean | null = null
  for (const line of lines) {
    for (let at = line.indexOf('\\'); at >= 0; at = line.indexOf('\\', at + 1)) {
      const next = line[at + 1]
      if (next === '{' && (line[at + 2] === '/' || line[at + 2] === '*' || line[at + 2] === '#')) return true
      if (next === '[' && (line.startsWith('^]', at + 2) || line.startsWith('----', at + 2))) return true
      if (next === '*' && (breaks ??= breakInPair(group))) return true
    }
  }
  return false
}

/** Whether emphasis or strong below `nodes` holds a soft break, behind which `starAfterBreak` can find a star. */
function breakInPair(nodes: readonly Node[]): boolean {
  const pending = [...nodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ((node.type === 'emphasis' || node.type === 'strong') && node.children.some((child) => child.type === 'soft_break')) return true
    forEachSlot(node, (children) => { for (const child of children) pending.push(child) })
  }
  return false
}

/** C2-W-089: the group as the repair writes it, compared with the plan in `both`. */
/** The `both` path: the repair runs from the escapes as they stood before the plan, and the two forms are compared. */
function compareWithRepair(
  w: Writer, run: WriterRun, document: DocumentNode, from: number, first: boolean, before: ReadonlyMap<TextNode, number[]>,
): number {
  const planned = w.lines
  w.escapes = new Map(before)
  const end = repairGroup(w, document, from, first, w.losses.entries.length)
  if (w.lines.join('\n') !== planned.join('\n')) {
    run.stats.differences.push(`${JSON.stringify(planned.join('\n'))} repair ${JSON.stringify(w.lines.join('\n'))}`)
  }
  return end
}

/**
 * Writes the group of top-level blocks that starts at `from` into `w.lines` and returns its end:
 * by its plan where the plan decides it, and by the repair otherwise.
 */
function clearGroupChoices(w: Writer): void {
  if (w.escapes.size > 0) w.escapes = new Map()
  if (w.forms.size > 0) w.forms.clear()
  if (w.attempts.size > 0) w.attempts.clear()
}

interface EarlyState {
  losses: LossMark
  blankFirst: boolean
  parsed: DocumentNode | null
}

function saveEarlyState(w: Writer): EarlyState {
  return { losses: markLosses(w), blankFirst: w.blankFirst, parsed: w.parsed }
}

function restoreEarlyState(w: Writer, state: EarlyState): void {
  clearGroupChoices(w)
  w.lines = []
  w.blankFirst = state.blankFirst
  w.parsed = state.parsed
  rollBackLosses(w, state.losses)
  w.probes.clear()
}

/** C2-W-146: new pair escapes go through the repair's readback test until no pair is left. */
function repairPairEscapes(w: Writer, run: WriterRun, document: DocumentNode, from: number, first: boolean,
  initialEnd: number): number {
  let end = initialEnd
  for (let round = 0; round < MAX_PAIR_ROUNDS; round++) {
    const asked = pairEscapes(document.children.slice(from, end), w.escapes)
    if (asked.size === 0) break
    if (round === 0) run.stats.repaired++
    const before = saveGroup(w, end)
    addAsked(w, asked)
    end = repairGroup(w, document, from, first, w.losses.entries.length)
    if (w.losses.entries.length > before.losses.entries) {
      end = restoreGroup(w, before)
      break
    }
  }
  return end
}

/** The early pair escapes of the group being started; `addAsked` hands their lists to the writer before the write. */
const EARLY: Asked = new Map()

function writeGroup(w: Writer, run: WriterRun, document: DocumentNode, from: number, first: boolean): number {
  // A blank line separates groups, so earlier escape and form choices no longer affect readback.
  if (from > 0) clearGroupChoices(w)
  const group = document.children.slice(from, groupEnd(w, document.children, from))
  const reach = pairReach(group, w.escapes, EARLY)
  // Pair rules depend on text and escapes already chosen, so place their ordinary escapes before
  // the first write. The check below still handles a pair exposed by a later repair choice.
  let placedEarly = reach === EARLY_PAIRS || reach === EARLY_FINAL
  const escapedEarly = EARLY.size > 0
  const saved = escapedEarly ? saveEarlyState(w) : null
  if (escapedEarly) {
    addAsked(w, EARLY)
    EARLY.clear()
  }
  const final = reach === EARLY_FINAL ? new Map([...w.escapes].map(([node, offsets]) => [node, [...offsets]])) : null
  const planned = run.stats.planned
  // An early escape can expose a later opener, as in `_b _c_` after escaping the first `_`: the plan tests for it.
  const pairs: GroupPairs = { late: reach === LATE_PAIRS || escapedEarly, settled: false, final }
  let end = writeGroupOnce(w, run, document, from, first, pairs)
  if (saved !== null && w.losses.entries.length > saved.losses.entries) {
    restoreEarlyState(w, saved)
    pairs.late = false
    end = writeGroupOnce(w, run, document, from, first, pairs)
    placedEarly = false
  }
  if (reach === NO_PAIRS || pairs.settled || (placedEarly && !escapedEarly && run.path === 'plan' && run.stats.planned > planned)) {
    return end
  }
  return repairPairEscapes(w, run, document, from, first, end)
}

/** The choices of the group a pair round can take back; the losses of the document are a mark, not a copy. */
interface SavedGroup {
  end: number
  lines: string[]
  escapes: Map<TextNode, number[]>
  forms: Map<Node, number>
  attempts: Writer['attempts']
  blankFirst: boolean
  losses: LossMark
  parsed: DocumentNode | null
}

function saveGroup(w: Writer, end: number): SavedGroup {
  return {
    end, lines: [...w.lines], escapes: new Map([...w.escapes].map(([node, at]) => [node, [...at]])), forms: new Map(w.forms),
    attempts: new Map(w.attempts), blankFirst: w.blankFirst, losses: markLosses(w), parsed: w.parsed,
  }
}

function restoreGroup(w: Writer, saved: SavedGroup): number {
  w.lines = saved.lines
  w.escapes = saved.escapes
  w.forms = saved.forms
  w.attempts = saved.attempts
  w.blankFirst = saved.blankFirst
  rollBackLosses(w, saved.losses)
  w.parsed = saved.parsed
  return saved.end
}

const MAX_PAIR_ROUNDS = 64

function writeGroupOnce(w: Writer, run: WriterRun, document: DocumentNode, from: number, first: boolean,
  pairs: GroupPairs): number {
  // C2-W-002: the losses that the first write reports count for the repair that follows a plan with no decision.
  const reported = w.losses.entries.length
  w.planWhy = null
  if (run.path !== 'repair') {
    const end = groupEnd(w, document.children, from)
    // The `both` path compares with a repair from the escapes before the plan, which `planGroup` changes in place.
    const before = run.path === 'both' ? new Map(w.escapes) : w.escapes
    if (planGroup(w, run, document.children.slice(from, end), first, pairs)) {
      run.stats.planned++
      return run.path === 'both' ? compareWithRepair(w, run, document, from, first, before) : end
    }
  }
  run.stats.repaired++
  const work = w.work.chars
  const saved = w.planWhy === 'kind' ? saveGroup(w, groupEnd(w, document.children, from)) : null
  let end = w.planWhy === 'depth cap'
    ? repairBareAlts(w, document, from, first, reported) : repairGroup(w, document, from, first, reported)
  if (saved !== null && w.losses.entries.length > reported) end = planInstead(w, run, document, from, first, pairs, saved, reported)
  run.stats.work.push([w.lines.reduce((total, line) => total + line.length + 1, 0), w.work.chars - work])
  return end
}

/** C2-W-010: where the rounds lose a node of a group the plan writes whole, the plan's form is taken. */
function planInstead(w: Writer, run: WriterRun, document: DocumentNode, from: number, first: boolean, pairs: GroupPairs,
  saved: SavedGroup, reported: number): number {
  restoreGroup(w, saved)
  w.planKinds = true
  try {
    if (planGroup(w, run, document.children.slice(from, saved.end), first, pairs)) return saved.end
  } finally {
    w.planKinds = false
  }
  // The losses of the rounds were taken back with the group, so the rounds run again rather than restore them.
  restoreGroup(w, saved)
  w.planWhy = null
  return repairGroup(w, document, from, first, reported)
}

/**
 * C2-I-118: past the depth cap the brackets of an alt text are text, and the backslash a bracket without a partner
 * takes elsewhere removes an opener and moves the cap. Such a group is repaired with bare alt brackets first, and as
 * usual where that reports a loss.
 */
function repairBareAlts(w: Writer, document: DocumentNode, from: number, first: boolean, reported: number): number {
  const saved = saveGroup(w, groupEnd(w, document.children, from))
  w.bareAlts = true
  let end: number
  try {
    end = repairGroup(w, document, from, first, reported)
  } finally {
    w.bareAlts = false
  }
  if (w.losses.entries.length === reported) return end
  restoreGroup(w, saved)
  return repairGroup(w, document, from, first, reported)
}

/**
 * C2-W-089: the group is parsed again and written again until it reads back as its blocks.
 * `first` says that the group starts the document, where line 1 can open frontmatter (C2-B-161).
 */
function repairGroup(w: Writer, document: DocumentNode, from: number, first: boolean, reported: number): number {
  const saved = w.kindRounds ? saveGroup(w, groupEnd(w, document.children, from)) : null
  const end = repairOnce(w, document, from, first, reported)
  if (saved === null || w.losses.entries.length === reported) return end
  // C2-W-088: where the rounds by kind lose a node, the rounds of the reported openers only give the form.
  restoreGroup(w, saved)
  w.kindRounds = false
  try {
    return repairOnce(w, document, from, first, reported)
  } finally {
    w.kindRounds = true
  }
}

function repairOnce(w: Writer, document: DocumentNode, from: number, first: boolean, reported: number): number {
  const start = w.work.chars
  const end = repairRounds(w, document, from, first, reported)
  w.work.spent += w.work.chars - start
  w.work.limit = Infinity
  return end
}

function repairRounds(w: Writer, document: DocumentNode, from: number, first: boolean, reported: number): number {
  const nodes = document.children
  const history: RepairHistory = { ids: new Map(), recent: [], seen: new Set(), rounds: 0, budget: 0 }
  for (;;) {
    const end = groupEnd(w, nodes, from)
    const group = nodes.slice(from, end)
    resetLines(w)
    writeBlocks(w, group, '', 0, false)
    if (w.lines.length === 0) return end
    if (refuseDeepGroup(w, group)) return end
    if (repeatedRepair(w, group, history)) return end
    if (!settle(w, document, group, first && !w.blankFirst) && !exhausted(w)) {
      if (w.losses.entries.length === reported) reportUnread(w, group)
      pruneGroupEscapes(w, group, first && !w.blankFirst)
      return end
    }
  }
}

/** C2-W-011: a group beyond the parser's nesting limit has no spelling. */
function refuseDeepGroup(w: Writer, group: readonly Node[]): boolean {
  if (!beyondSourceDepth(group)) return false
  const host = group[0]
  if (host !== undefined) lose(w, host, null)
  return true
}

/**
 * C2-W-011, C2-A-171: a tree beyond the parser's nesting limit has no source that reads back as that tree. The
 * levels are those the reader counts; the children of an include are not written, so they do not count.
 */
function beyondSourceDepth(group: readonly Node[]): boolean {
  const pending = group.map((node) => ({ node, levels: nodeLevels(node.type, 0, 0) }))
  for (;;) {
    const item = pending.pop()
    if (item === undefined) return false
    if (beyondParserLevels(item.levels)) return true
    if (item.node.type === 'include') continue
    const [blocks, inlines] = item.levels
    forEachSlot(item.node, (children) => {
      for (const node of children) pending.push({ node, levels: nodeLevels(node.type, blocks, inlines) })
    })
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
    if (block !== undefined && at < group.length && writerEqual(group[at]!, block)) continue
    lose(w, group[Math.min(at, group.length - 1)]!, null)
    return
  }
}

/** C2-B-166: an inline span can put the table opener beyond a text escape. Its closing text pipe can stop the row. */
function escapeTableCloser(w: Writer, check: Check, group: readonly Node[], parsed: DocumentNode): boolean {
  // A table can start on a later line of a paragraph, so block-by-block
  // comparison cannot always reach the text pipe that closes its row.
  const paragraph = group.length === 1 && group[0]?.type === 'paragraph' ? group[0] : null
  if (paragraph === null || !parsed.children.some((node) => node.type === 'table') ||
    !paragraph.children.some((node) => 'value' in node && typeof node.value === 'string' &&
      node.value.includes('\n') && node.value.includes('|'))) return false
  const pending: Node[] = [...paragraph.children]
  while (pending.length > 0) {
    const node = pending.pop()!
    if (node.type === 'text') {
      const at = node.value.lastIndexOf('|')
      if (at >= 0 && !(w.escapes.get(node) ?? []).includes(at)) {
        check.escapes.push([node, at])
        return true
      }
    }
    if ('children' in node) for (const child of node.children) pending.push(child)
  }
  return false
}

function compareGroup(w: Writer, document: DocumentNode, group: readonly Node[], first: boolean): Check {
  const source = `${first ? '' : '\n'}${w.lines.join('\n')}\n`
  const check = createCheck(w)
  check.source = source
  const parsed = parseChunk(w, source)
  w.parsed = parsed
  if (escapeTableCloser(w, check, group, parsed)) return check
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

function writeDocument(w: Writer, run: WriterRun, document: DocumentNode): string {
  const nodes = document.children
  const out: string[] = []
  let before: Node | null = null
  let list: Node | null = null
  for (let at = 0; at < nodes.length;) {
    const from = at
    at = writeGroup(w, run, document, from, out.length === 0)
    if (w.lines.length === 0) continue
    if (out.length === 0 && w.blankFirst) out.push('')
    const blanks = before === null ? 0 : blankLinesBetween(w, before, list, nodes[from]!, false)
    addLines(out, w.lines, blanks)
    w.work.written += w.lines.reduce((total, line) => total + line.length + 1, blanks)
    before = nodes[at - 1]!
    list = lastBlock(nodes, from, at, list)
  }
  // C2-W-022: the output ends with one line ending.
  return out.length === 0 ? '\n' : `${out.join('\n')}\n`
}

function rootMetadataLosses(document: DocumentNode, diagnostics: Diagnostic[]): void {
  for (const name of ['headers', 'footers'] as const) {
    if (document.metadata?.[name] !== undefined) diagnostics.push({
      code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
      message: `Carve source cannot spell root metadata.${name}`, path: `/metadata/${name}`,
    })
  }
  for (const name of ['abstract', 'keywords'] as const) if (document.metadata?.[name] !== undefined) diagnostics.push({
    code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
    message: `Carve source cannot spell root metadata.${name}`, path: `/metadata/${name}`,
  })
  // C2-W-011, C2-M-074: no source gives the document node a language or a direction (C2-M-004 imports them).
  for (const name of ['lang', 'dir'] as const) if (document[name] !== undefined) diagnostics.push({
    code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
    message: `Carve source cannot spell the document ${name}`, path: `/${name}`,
  })
  if (document.metadata?.fields !== undefined && !document.children.some((node) => node.type === 'frontmatter')) {
    diagnostics.push({ code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
      message: 'Carve source cannot spell root metadata.fields', path: '/metadata/fields' })
  }
}

/** C2-W-088, C2-W-125: only these opener shapes can lose a backslash without changing the ordered repair. */
/** A star after a break inside a pair can be a stale repair escape; one before a sibling pair can be a C2-W-125 seed. */
function starAfterBreak(nodes: readonly Node[], byte: number, parent: Node | null): boolean {
  if (nodes.length > 8 && ordered(nodes)) return starIn(nodes, holderOf(nodes, byte), byte, parent)
  for (let index = 0; index < nodes.length; index++) {
    const pos = nodes[index]!.pos
    if (pos === undefined || byte < pos.startOffset || byte >= pos.endOffset) continue
    if (starIn(nodes, index, byte, parent)) return true
    if (nodes[index]!.type === 'text') return false
  }
  return false
}

/** The test of `starAfterBreak` at the sibling `index`, which holds `byte`, or -1 for none. */
function starIn(nodes: readonly Node[], index: number, byte: number, parent: Node | null): boolean {
  if (index < 0) return false
  const node = nodes[index]!
  if (node.type === 'text') return (parent?.type === 'emphasis' || parent?.type === 'strong') &&
    nodes[index - 1]?.type === 'soft_break'
  return starAfterBreak(childNodes(node), byte, node)
}

/** In siblings that do not overlap, the one that holds `byte`, or -1: only the first that ends behind it can. */
function holderOf(nodes: readonly Node[], byte: number): number {
  let low = 0
  let high = nodes.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (nodes[middle]!.pos!.endOffset <= byte) low = middle + 1
    else high = middle
  }
  return low < nodes.length && nodes[low]!.pos!.startOffset <= byte ? low : -1
}

const ORDERED = new WeakMap<readonly Node[], boolean>()

/** Whether every node of `nodes` has a position and each starts where the one before it ends or later. */
function ordered(nodes: readonly Node[]): boolean {
  let known = ORDERED.get(nodes)
  if (known !== undefined) return known
  known = true
  for (let at = 0; at < nodes.length && known; at++) {
    const pos = nodes[at]!.pos
    if (pos === undefined || (at > 0 && pos.startOffset < nodes[at - 1]!.pos!.endOffset)) known = false
  }
  ORDERED.set(nodes, known)
  return known
}

/** Whether `starAfterBreak` can hold anywhere below `nodes`: a text after a soft break in emphasis or strong. */
function textAfterBreak(nodes: readonly Node[]): boolean {
  const pending = [...nodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const children = childNodes(node)
    if (node.type === 'emphasis' || node.type === 'strong') {
      for (let at = 1; at < children.length; at++) {
        if (children[at]!.type === 'text' && children[at - 1]!.type === 'soft_break') return true
      }
    }
    for (const child of children) pending.push(child)
  }
  return false
}

/**
 * The scan of `pruneGroupEscapes`: the UTF-8 offset of `scanned` in the source, and whether the parse of the source
 * holds a star `starAfterBreak` can find, so that each backslash costs no walk of what lies before it.
 */
interface PruneScan {
  scanned: number
  byte: number
  stars: boolean | null
}

function prunableStar(w: Writer, source: string, at: number, scan: PruneScan): boolean {
  if (w.parsed === null || !(scan.stars ??= textAfterBreak(w.parsed.children))) return false
  scan.byte += utf8Length(source.slice(scan.scanned, at))
  scan.scanned = at
  return starAfterBreak(w.parsed.children, scan.byte, null)
}

function prunableOpener(w: Writer, source: string, at: number, scan: PruneScan): boolean {
  const next = source[at + 1]
  if (next === '*') return prunableStar(w, source, at, scan)
  if (next === '[') {
    if (source.startsWith('^]', at + 2)) return true
    if (!source.startsWith('----', at + 2)) return false
    const close = source.indexOf(']', at + 2)
    const lineEnd = source.indexOf('\n', at + 2)
    return source[at - 1] !== '^' || close < 0 || (lineEnd >= 0 && close > lineEnd)
  }
  if (next !== '{') return false
  if (source[at + 2] === '/' || source[at + 2] === '*') return true
  if (source[at + 2] !== '#') return false
  const close = source.indexOf('}', at + 3)
  const escapedDash = source.indexOf('\\-', at + 3)
  return close >= 0 && (escapedDash < 0 || escapedDash > close)
}

/** C2-W-088 and C2-W-089: test candidate escapes within the group that wrote them. */
function pruneGroupEscapes(w: Writer, group: readonly Node[], first: boolean): void {
  let source = `${first ? '' : '\n'}${w.lines.join('\n')}\n`
  let at = source.indexOf('\\')
  // A pruned backslash at `at` leaves the source before `at` as it was, so the scan goes on from there.
  const scan: PruneScan = { scanned: 0, byte: 0, stars: null }
  while (at >= 0) {
    // C2-W-133: each candidate is one parse more, so the pruning counts toward the limit of the repair.
    if (exhausted(w)) {
      const host = group[0]
      if (host !== undefined) refuseRepair(w, host)
      break
    }
    // C2-W-125, case two: a backslash directly behind a quote mark is the escape of the neighbor that decides its direction.
    if (source[at - 1] !== '"' && source[at - 1] !== "'" && prunableOpener(w, source, at, scan)) {
      const candidate = source.slice(0, at) + source.slice(at + 1)
      const parsed = parseChunk(w, candidate)
      if (parsed.children.length === group.length && parsed.children.every((node, index) => {
        const expected = group[index]
        return expected !== undefined && treesEqual(node, expected)
      })) {
        source = candidate
        w.parsed = parsed
        scan.stars = null
        at = source.indexOf('\\', at)
        continue
      }
    }
    at = source.indexOf('\\', at + 1)
  }
  w.lines = source.slice(first ? 0 : 1, -1).split('\n')
}

const NEXT_LINE_CONTROL = /%% carve-lint-disable-next-line(?![^ ,])/
const BLANK_IN_CONTAINERS = /^[ \t>]*\r?$/
/** C2-B-215: the keyword starts the comment, and the comment ends or a space or a comma follows it. */
const CONTROL_VALUE = /^carve-lint-disable-next-line(?![^ ,])/
/** The parse work of the C2-W-144 check, as a multiple of the document length, so that it stays linear. */
const CONTROL_CHECK_BUDGET = 16

/** The runs of blank lines, as line ranges, that stand directly below a next-line control comment. */
function blanksBelowControls(lines: readonly string[]): [number, number][] {
  const spans: [number, number][] = []
  for (let at = 0; at + 1 < lines.length; at++) {
    if (!NEXT_LINE_CONTROL.test(lines[at]!) || !BLANK_IN_CONTAINERS.test(lines[at + 1]!)) continue
    let end = at + 1
    while (end < lines.length && BLANK_IN_CONTAINERS.test(lines[end]!)) end++
    if (end < lines.length - 1) spans.push([at + 1, end])
    at = end - 1
  }
  return spans
}

/** The next-line control comments of a tree, in a fixed order of its nodes. */
function controlComments(node: unknown, found: CommentNode[] = []): CommentNode[] {
  if (Array.isArray(node)) {
    for (const item of node) controlComments(item, found)
  } else if (isRecord(node)) {
    if (node['type'] === 'comment' && node['form'] === 'line' && typeof node['value'] === 'string' &&
      CONTROL_VALUE.test(node['value'])) found.push(node as unknown as CommentNode)
    for (const key of Object.keys(node).sort()) if (key !== 'pos') controlComments(node[key], found)
  }
  return found
}

/** Whether the line below `comment` in `lines` holds content, so that the comment suppresses findings on it. */
function suppressesBelow(comment: CommentNode, lines: readonly string[] | null): boolean {
  const end = comment.pos?.endLine
  if (lines === null || end === undefined) return true
  const below = lines[end]
  return below !== undefined && !BLANK_IN_CONTAINERS.test(below)
}

/** Whether `candidate` reads back as `tree` and gives no control comment a line it did not suppress (`live`). */
function sameControls(w: Writer, candidate: string, tree: readonly Node[], live: readonly boolean[]): boolean {
  const parsed = parseWritten(w, candidate).children
  if (parsed.length !== tree.length || !parsed.every((node, index) => treesEqual(node, tree[index]!))) return false
  const lines = candidate.split('\n')
  const controls = controlComments(parsed)
  return controls.length === live.length &&
    controls.every((comment, index) => live[index] === true || !suppressesBelow(comment, lines))
}

/** C2-W-144: leaves out the blank lines below each control comment of `live` that suppressed a line of the source. */
function dropBlanksBelow(w: Writer, source: string, tree: readonly Node[], live: readonly boolean[]): string {
  const lines = source.split('\n')
  const below = new Set(controlComments(tree).flatMap((comment, index) =>
    live[index] === true && comment.pos !== undefined ? [comment.pos.endLine] : []))
  const spans = blanksBelowControls(lines).filter(([from]) => below.has(from))
  if (spans.length === 0) return source
  let budget = CONTROL_CHECK_BUDGET * source.length
  const holds = (candidate: string): boolean => {
    budget -= candidate.length
    return sameControls(w, candidate, tree, live)
  }
  const without = (kept: readonly [number, number][]): string => {
    const dropped = new Set<number>()
    for (const [from, to] of kept) for (let index = from; index < to; index++) dropped.add(index)
    return lines.filter((_, index) => !dropped.has(index)).join('\n')
  }
  const all = without(spans)
  if (holds(all)) return all
  const taken: [number, number][] = []
  for (const span of spans) {
    if (budget <= 0) break
    if (holds(without([...taken, span]))) taken.push(span)
  }
  return without(taken)
}

/** C2-W-144: a blank line below each control comment that suppressed nothing in the source and would now. */
function restoreBlanksBelow(w: Writer, written: string, tree: readonly Node[], live: readonly boolean[]): string {
  if (live.every((entry) => entry)) return written
  const lines = written.split('\n')
  const at = new Set(controlComments(parseWritten(w, written).children).flatMap((comment, index) =>
    live[index] !== true && comment.pos !== undefined && suppressesBelow(comment, lines) ? [comment.pos.endLine] : []))
  if (at.size === 0) return written
  // The blank line keeps the quote marks of the comment line, so that it stays inside the quote.
  const candidate = lines.flatMap((line, index) => at.has(index) ? [/^(?:[ \t]*>)*/.exec(lines[index - 1]!)![0], line] : [line])
    .join('\n')
  return sameControls(w, candidate, tree, live) ? candidate : written
}

/**
 * C2-W-144: a control comment that suppressed a line of `original`, the source of the tree, is written directly above
 * the next line, and one that suppressed nothing keeps a blank line below it, where the tree reads back the same.
 */
function keepControlsAbove(w: Writer, document: DocumentNode, source: string, original: string | null): string {
  if (!source.includes('carve-lint-disable-next-line')) return source
  const authored = original?.split('\n') ?? null
  const live = controlComments(document.children).map((comment) => suppressesBelow(comment, authored))
  const tree = parseWritten(w, source).children
  return restoreBlanksBelow(w, dropBlanksBelow(w, source, tree, live), tree, live)
}

/** C2-L-056: the source of a sidecar, or null where it holds the bytes of a base64 input. */
function layoutSource(layout: WriteOptions['layout']): string | null {
  return layout?.encoding === 'base64' ? null : layout?.source ?? null
}

/** C2-W-145: the document written with the marks of its span counts, its losses at the cells of the supplied tree. */
function writeWithSpanMarks(w: Writer, run: WriterRun, document: DocumentNode, original: string | null): string {
  // A document made of prose leaves cannot hold a table. Avoid a second walk through every inline
  // node just to establish that no span marks need adding.
  if (document.children.every((node) => node.type === 'paragraph' || node.type === 'heading')) {
    return keepControlsAbove(w, document, writeDocument(w, run, document), original)
  }
  const spans = addSpanMarks(document)
  let source: string
  try {
    source = keepControlsAbove(w, document, writeDocument(w, run, document), original)
  } finally {
    spans?.restore()
  }
  if (spans === null) return source
  w.losses.nodes = w.losses.nodes.map((node) => (node === null ? null : spans.covering.get(node) ?? node))
  for (const cell of spans.unspelled) lose(w, cell, 'rowspan')
  return source
}

/** C2-W-151: the document written without the spaces and tabs that would end a line of text, then restored. */
function writeTrimmed(w: Writer, run: WriterRun, document: DocumentNode, original: string | null): string {
  const restore = trimLineEnds(document, (table) => tableFormat(w, table) !== 'pipe')
  try {
    return writeWithSpanMarks(w, run, document, original)
  } finally {
    restore?.()
  }
}

type LossFrame = { node: Node; path: string; parent: LossFrame | null; inLineBlock: boolean }
type LineFeedCandidate = { path: string; node: TextNode }

function hasLostWrapper(frame: LossFrame, lossNodes: ReadonlySet<Node | null>): boolean {
  for (let ancestor = frame.parent; ancestor !== null; ancestor = ancestor.parent) {
    if (lossNodes.has(ancestor.node) && ['paragraph', 'line', 'line_block'].includes(ancestor.node.type)) return true
  }
  return false
}

/** Inspect written node slots; expanded includes and metadata text are not written here. */
function lineFeedCandidates(document: DocumentNode, w: Writer):
  { text: LineFeedCandidate[]; comments: string[] } {
  const text: LineFeedCandidate[] = []
  const comments: string[] = []
  const lossNodes = new Set(w.losses.nodes)
  const pending: LossFrame[] = [{ node: document, path: '', parent: null, inLineBlock: false }]
  while (pending.length > 0) {
    const frame = pending.pop()!
    const { node, path, inLineBlock } = frame
    if (node.type === 'text' && node.value.includes('\n') && hasLostWrapper(frame, lossNodes)) {
      text.push({ path, node })
      if (!w.lost.has(node)) lose(w, node, 'value')
    }
    if (inLineBlock && node.type === 'comment' && node.form === 'braced' && node.value.includes('\n')) {
      comments.push(path)
    }
    if (node.type === 'include') continue
    forEachSlot(node, (children, step, single) => {
      if (step.startsWith('metadata/')) return
      for (let at = children.length - 1; at >= 0; at--) {
        pending.push({ node: children[at]!, path: `${path}/${step}${single ? '' : `/${at}`}`,
          parent: frame, inLineBlock: inLineBlock || node.type === 'line_block' })
      }
    }, undefined, document.extensions ?? [])
  }
  return { text, comments }
}

function suppressLineFeedWrappers(document: DocumentNode, diagnostics: Diagnostic[], text: LineFeedCandidate[]): void {
  if (text.length === 0) return
  const leaves = new Set(text.map(entry => entry.node))
  const ancestors = new Set<string>()
  for (const { path } of text) {
    for (let end = path.lastIndexOf('/'); end > 0; end = path.lastIndexOf('/', end - 1)) {
      ancestors.add(path.slice(0, end))
    }
    ancestors.add('')
  }
  for (let at = diagnostics.length - 1; at >= 0; at--) {
    const entry = diagnostics[at]!
    if (entry.code !== 'structure-unspellable' || !ancestors.has(entry.path ?? '')) continue
    const wrapper = nodeAt(document, entry.path ?? '')
    if (wrapper === null) continue
    const leaf = onlyLineFeedLeaf(wrapper)
    if (leaf !== null && leaves.has(leaf)) diagnostics.splice(at, 1)
  }
}

function relocateCommentLosses(diagnostics: Diagnostic[], comments: string[]): void {
  for (const path of comments) {
    const entry = diagnostics.find(row => row.path === `${path}/value` && row.code === 'field-unspellable')
    if (entry === undefined) continue
    entry.code = 'structure-unspellable'
    entry.path = path
    entry.message = 'Carve source cannot spell a comment node here'
  }
}

/** Locate writer losses, moving a line-feed mismatch from a wrapper to its written leaf. */
function writerDiagnostics(document: DocumentNode, w: Writer): Diagnostic[] {
  if (!w.losses.entries.some((entry, at) => entry.code === 'structure-unspellable' ||
    (entry.code === 'field-unspellable' && w.losses.nodes[at]?.type === 'comment'))) {
    const diagnostics = locateFindings(document, w.losses)
    rootMetadataLosses(document, diagnostics)
    return diagnostics
  }
  const candidates = lineFeedCandidates(document, w)
  // C2-W-103: locate original and added findings together, retaining ranges and include ancestry.
  const diagnostics = locateFindings(document, w.losses)
  suppressLineFeedWrappers(document, diagnostics, candidates.text)
  relocateCommentLosses(diagnostics, candidates.comments)
  rootMetadataLosses(document, diagnostics)
  return diagnostics
}

/** Writes a tree that is known to be valid, by the path `path`, and reports how it wrote it. */
function prepareDocumentWriter(w: Writer, document: DocumentNode, layout: WriteOptions['layout']): void {
  w.linkKeys = new Set(document.children.filter((node) => node.type === 'link_reference_definition').map((node) => node.key))
  if (layout !== undefined && w.facts !== null) readLayout(w, w.facts, document, layout.nodes)
  readAbbreviations(w, document)
  const lead = document.children[0]
  w.leadingFrontmatter = lead?.type === 'frontmatter' && lead.attrs === undefined ? lead : null
  w.topBlocks = new Map(document.children.map((node, index) => [node, document.children[index - 1]]))
}

/** Writes a tree that is known to be valid, by the path `path`, and reports how it wrote it. */
export function writeTreeWithStats(document: DocumentNode, options: WriteOptions | undefined, path: WriterPath = 'plan',
  check = options?.check !== false, linkKeys?: ReadonlySet<string>, original: string | null = layoutSource(options?.layout),
  verifiedSourceBytes?: Uint8Array):
  { output: WriteOutput, stats: WriterStats } {
  const stats: WriterStats = { planned: 0, repaired: 0, differences: [], reasons: new Map(), samples: new Map(), parses: 0, work: [] }
  const run: WriterRun = { path, check, stats }
  const layout = options?.layout
  const facts = layout === undefined ? null : new Map<Node, WriterFacts>()
  const w = createWriter(facts, options?.alignTables === true, options?.extensions)
  w.verifiedSourceBytes = verifiedSourceBytes
  prepareDocumentWriter(w, document, layout)
  if (linkKeys !== undefined) w.linkKeys = linkKeys
  w.work.source = original?.length ?? 0
  const source = writeTrimmed(w, run, document, original)
  const diagnostics = writerDiagnostics(document, w)
  stats.parses = w.parses
  return { output: { source, diagnostics }, stats }
}


/** Writes a tree that is known to be valid. */
export function writeTree(document: DocumentNode, options: WriteOptions | undefined, check?: boolean,
  original?: string, verifiedSourceBytes?: Uint8Array): WriteOutput {
  return writeTreeWithStats(document, options, 'plan', check ?? options?.check !== false, undefined, original,
    verifiedSourceBytes).output
}

/** The canonical Carve source of a tree, with what could not be written (C2-W-011). The tree is validated first. */
export function writeWithDiagnostics(document: DocumentNode, options?: WriteOptions): WriteOutput {
  validateTree(document, undefined, undefined, options?.extensions)
  return writeTree(document, options)
}

/**
 * `write` of a tree as if the link reference definitions with the keys `linkKeys` followed it, without writing them:
 * the tree is written with those keys defined.
 */
export function writeWithLinkKeys(document: DocumentNode, linkKeys: ReadonlySet<string>): string {
  validateTree(document)
  const result = writeTreeWithStats(document, undefined, 'plan', true, linkKeys).output
  if (writerHasLoss(result.diagnostics)) throw new CarveWriteError(result.diagnostics)
  return result.source
}

/** The canonical Carve source of a tree (C2-W-001). */
export function write(document: DocumentNode, options?: WriteOptions): string {
  const result = writeWithDiagnostics(document, options)
  if (writerHasLoss(result.diagnostics)) throw new CarveWriteError(result.diagnostics)
  return result.source
}
