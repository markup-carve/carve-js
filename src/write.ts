// The canonical writer (spec/0.2/writer.md): a tree, and optionally the sidecar that was returned
// with it, as Carve source (C2-W-001). Blocks that a blank line separates are written and tested
// on their own (C2-W-089), so one block is written again only for its own escapes.
import { childNodes, type DocumentNode, forEachSlot, isRecord, type Node, pointerToken, SOURCE_ORDER, type TextNode } from './ast.ts'
import { treesEqual } from './ast-json.ts'
import { beyondParserLevels, nodeLevels, validateTree } from './ast-validate.ts'
import { addFinding, type Diagnostic, locateFindings } from './diagnostics.ts'
import { afterComments, blankLinesBetween, followingAttributes, writeBlocks } from './write-blocks.ts'
import { type Check, compareBlocks, createCheck, escapeOpeners, exhausted, extendChains, parseChunk } from './write-check.ts'
import { type Wrap } from './layout.ts'
import { isSecondHalf, unitBytes, utf8Length } from './positions.ts'
import { createWriter, lose, type Writer, type WriterFacts } from './write-state.ts'
import { createPlan, notePlaces, type Plan } from './write-plan.ts'
import { type ExtensionDefinition } from './extensions/types.ts'
import { sourceCoreEquivalent, withCoreInlines } from './write-extension-source.ts'

/** One entry of a sidecar, as far as the writer reads it (C2-L-009, C2-L-046). */
export interface LayoutEntry extends WriterFacts {
  path: string
}

export interface WriteOptions {
  extensions?: readonly ExtensionDefinition[]
  /** The sidecar of the tree (C2-L-004). Only its node entries are read. */
  layout?: { nodes: readonly LayoutEntry[] }
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
  if (node.type === 'paragraph') return before.type === 'definition_list'
  return node.type === 'comment' && blankLinesBetween(w, before, null, node, false) === 0
}

/**
 * The end of the group of blocks that starts at `from`: the blocks behind it that no blank line
 * separates from it, and what the block before reads differently.
 */
function isBridged(w: Writer, nodes: readonly Node[], from: number, at: number): boolean {
  let priorAt = at - 1
  while (priorAt >= from && nodes[priorAt]?.type === 'comment') priorAt--
  const prior = nodes[priorAt]
  if (prior?.type !== 'list' && prior?.type !== 'definition_list' && prior?.type !== 'footnote') return false
  const node = nodes[at]
  const following = node?.type === 'comment' ? afterComments(nodes, at) : node
  return followingAttributes(w, following) !== ''
}

function groupEnd(w: Writer, nodes: readonly Node[], from: number): number {
  let end = from + 1
  while (end < nodes.length) {
    const before = nodes[end - 1]!
    const node = nodes[end]!
    const bridged = isBridged(w, nodes, from, end)
    const hoisted = node.type === 'comment' && bridged
    const belongs = before.type === 'comment' && bridged
    if (!hoisted && !belongs && !joinsGroup(w, before, node)) break
    end++
  }
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
// The nesting of inline nodes stays under the depth cap of the parser.
const MAX_LEAF_DEPTH = 200

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
  return parseChunk(w, `${first ? '' : '\n'}${w.lines.join('\n')}\n`)
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
  remainingChars: number
}

const MAX_REPAIR_CHARS = 20_000_000
const MIN_REPAIR_ROUNDS = 32
// C2-W-133: every parse of a repair, its probes included, reads at most this many characters per character of the
// group, or the floor for a short group, so the repair of any group takes time linear in its size. The floor is
// above the 20 million characters that the slowest of 20,000 property documents needs (four kilobytes of
// unclosed braced openers past the depth cap), so no output that finished before is refused now.
const WORK_FACTOR = 1000
const WORK_FLOOR = 24_000_000

/** C2-W-133: stop a repeated repair state or an exhausted repair budget. */
function repeatedRepair(w: Writer, group: readonly Node[], history: RepairHistory): boolean {
  const chars = w.lines.reduce((total, line) => total + line.length + 1, 0)
  if (history.rounds === 0) {
    history.remainingChars = Math.max(history.remainingChars, chars * MIN_REPAIR_ROUNDS)
    w.work.limit = w.work.chars + Math.max(WORK_FLOOR, chars * WORK_FACTOR)
  }
  history.rounds++
  history.remainingChars -= chars
  if (history.rounds > 8192 || history.remainingChars < 0 || exhausted(w)) {
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
  w.bareDotLead = false
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

/** The reason the plan of a group has no decision, or null. */
function planReason(w: Writer, group: readonly Node[], plan: Plan, reported: number): string | null {
  if (plan.undecided !== null) return plan.undecided
  if (w.losses.entries.length !== reported) return 'loss'
  // C2-W-016, C2-B-010: a CR that only spaces and tabs follow on its line, in a block value as in an inline, joins the line end.
  if (w.lines.filter(endsWithCr).length > plan.lost.length) return 'control'
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

/** C2-W-002, C2-A-193: the writer disregards standard data namespaces in its readback check. */
function writerEqual(expected: Node, actual: Node): boolean {
  if (treesEqual(expected, actual) || sourceCoreEquivalent(expected, actual)) return true
  if (treesEqual(withoutStandardData(expected), actual)) return true
  const cores = withCoreInlines(expected)
  return cores !== undefined && treesEqual(cores, actual)
}

/** C2-W-002: whether the written group reads back as its blocks. */
function readsBack(w: Writer, group: readonly Node[], first: boolean): boolean {
  const parsed = parseChunk(w, `${first ? '' : '\n'}${w.lines.join('\n')}\n`).children
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

function planGroup(w: Writer, run: WriterRun, group: readonly Node[], first: boolean): boolean {
  const reported = w.losses.entries.length
  const plan = settledPlan(w, run, group, first, reported)
  if (plan === null) return false
  const replaced = addPlanned(w, plan)
  if (replaced.length > 0) {
    resetLines(w)
    writeBlocks(w, group, '', 0, false)
  }
  // C2-W-016: a CR at a line end has no spelling; the group is reported and does not read back.
  for (const node of plan.lost) lose(w, node, 'value')
  if (run.check && plan.lost.length === 0 && w.lines.length > 0 && !readsBack(w, group, first)) {
    restoreEscapes(w, replaced)
    noteReason(run, 'check', '')
    return false
  }
  return true
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
function writeGroup(w: Writer, run: WriterRun, document: DocumentNode, from: number, first: boolean): number {
  // C2-W-002: the losses that the first write reports count for the repair that follows a plan with no decision.
  const reported = w.losses.entries.length
  if (run.path !== 'repair') {
    const end = groupEnd(w, document.children, from)
    // The `both` path compares with a repair from the escapes before the plan, which `planGroup` changes in place.
    const before = run.path === 'both' ? new Map(w.escapes) : w.escapes
    if (planGroup(w, run, document.children.slice(from, end), first)) {
      run.stats.planned++
      return run.path === 'both' ? compareWithRepair(w, run, document, from, first, before) : end
    }
  }
  run.stats.repaired++
  const work = w.work.chars
  const end = repairGroup(w, document, from, first, reported)
  run.stats.work.push([w.lines.reduce((total, line) => total + line.length + 1, 0), w.work.chars - work])
  return end
}

/**
 * C2-W-089: the group is parsed again and written again until it reads back as its blocks.
 * `first` says that the group starts the document, where line 1 can open frontmatter (C2-B-161).
 */
function repairGroup(w: Writer, document: DocumentNode, from: number, first: boolean, reported: number): number {
  const end = repairRounds(w, document, from, first, reported)
  w.work.limit = Infinity
  return end
}

function repairRounds(w: Writer, document: DocumentNode, from: number, first: boolean, reported: number): number {
  const nodes = document.children
  const history: RepairHistory = { ids: new Map(), recent: [], seen: new Set(), rounds: 0, remainingChars: MAX_REPAIR_CHARS }
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

function compareGroup(w: Writer, document: DocumentNode, group: readonly Node[], first: boolean): Check {
  const source = `${first ? '' : '\n'}${w.lines.join('\n')}\n`
  const check = createCheck(w)
  check.source = source
  const parsed = parseChunk(w, source)
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
      message: `root metadata.${name} has no spelling in Carve source`, path: `/metadata/${name}`,
    })
  }
  for (const name of ['abstract', 'keywords'] as const) if (document.metadata?.[name] !== undefined) diagnostics.push({
    code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
    message: `root metadata.${name} has no spelling in Carve source`, path: `/metadata/${name}`,
  })
  // C2-W-011, C2-M-074: no source gives the document node a language or a direction (C2-M-004 imports them).
  for (const name of ['lang', 'dir'] as const) if (document[name] !== undefined) diagnostics.push({
    code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
    message: `the document ${name} has no spelling in Carve source`, path: `/${name}`,
  })
  if (document.metadata?.fields !== undefined && !document.children.some((node) => node.type === 'frontmatter')) {
    diagnostics.push({ code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
      message: 'root metadata.fields has no spelling in Carve source', path: '/metadata/fields' })
  }
}

/** C2-W-088, C2-W-125: only these opener shapes can lose a backslash without changing the ordered repair. */
/** A star after a break inside a pair can be a stale repair escape; one before a sibling pair can be a C2-W-125 seed. */
function starAfterBreak(nodes: readonly Node[], byte: number, parent: Node | null): boolean {
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index]!
    const pos = node.pos
    if (pos === undefined || byte < pos.startOffset || byte >= pos.endOffset) continue
    if (node.type === 'text') return (parent?.type === 'emphasis' || parent?.type === 'strong') &&
      nodes[index - 1]?.type === 'soft_break'
    if (starAfterBreak(childNodes(node), byte, node)) return true
  }
  return false
}

function prunableOpener(w: Writer, source: string, at: number): boolean {
  const next = source[at + 1]
  if (next === '*') return w.parsed !== null && starAfterBreak(w.parsed.children, utf8Length(source.slice(0, at)), null)
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
  while (at >= 0) {
    // C2-W-133: each candidate is one parse more, so the pruning counts toward the limit of the repair.
    if (exhausted(w)) {
      const host = group[0]
      if (host !== undefined) refuseRepair(w, host)
      break
    }
    if (prunableOpener(w, source, at)) {
      const candidate = source.slice(0, at) + source.slice(at + 1)
      const parsed = parseChunk(w, candidate)
      if (parsed.children.length === group.length && parsed.children.every((node, index) => {
        const expected = group[index]
        return expected !== undefined && treesEqual(node, expected)
      })) {
        source = candidate
        w.parsed = parsed
        at = source.indexOf('\\', at)
        continue
      }
    }
    at = source.indexOf('\\', at + 1)
  }
  w.lines = source.slice(first ? 0 : 1, -1).split('\n')
}

/** Writes a tree that is known to be valid, by the path `path`, and reports how it wrote it. */
export function writeTreeWithStats(document: DocumentNode, options: WriteOptions | undefined, path: WriterPath = 'plan',
  check = options?.check !== false, linkKeys?: ReadonlySet<string>): { output: WriteOutput, stats: WriterStats } {
  const stats: WriterStats = { planned: 0, repaired: 0, differences: [], reasons: new Map(), samples: new Map(), parses: 0, work: [] }
  const run: WriterRun = { path, check, stats }
  const layout = options?.layout
  const facts = layout === undefined ? null : new Map<Node, WriterFacts>()
  const w = createWriter(facts, options?.alignTables === true, options?.extensions)
  w.linkKeys = linkKeys ??
    new Set(document.children.filter((node) => node.type === 'link_reference_definition').map((node) => node.key))
  if (layout !== undefined && facts !== null) readLayout(w, facts, document, layout.nodes)
  readAbbreviations(w, document)
  const source = writeDocument(w, run, document)
  // C2-W-103: a finding of the writer has the path of its node.
  const diagnostics = locateFindings(document, w.losses)
  rootMetadataLosses(document, diagnostics)
  stats.parses = w.parses
  return { output: { source, diagnostics }, stats }
}

/** Writes a tree that is known to be valid. */
export function writeTree(document: DocumentNode, options: WriteOptions | undefined, check?: boolean): WriteOutput {
  return writeTreeWithStats(document, options, 'plan', check ?? options?.check !== false).output
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
