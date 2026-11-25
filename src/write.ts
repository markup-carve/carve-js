// The canonical writer (spec/0.2/writer.md): a tree, and optionally the sidecar that was returned
// with it, as Carve source (C2-W-001). Blocks that a blank line separates are written and tested
// on their own (C2-W-089), so one block is written again only for its own escapes.
import { pushAll, pushReversed } from './arrays.ts'
import {
  childNodes, type CommentNode, type DocumentNode, forEachSlot, isBreak, isInlineParent, isRecord, type Node, pointerToken, SOURCE_ORDER,
  type TextNode,
} from './ast.ts'
import { treesEqual } from './ast-json.ts'
import { beyondParserLevels, nodeLevels, validateTree } from './ast-validate.ts'
import { addFinding, type Diagnostic, type FindingOrder, inDocumentOrder, locateFindings } from './diagnostics.ts'
import { holdsLineFeedValue, isKey, withSpelledValues } from './write-attributes.ts'
import {
  blankLinesBetween, commentLinesEnd, followingAttributes, followsContainerDirectly, joinsIndentedRun, topPredecessors, writeBlocks,
} from './write-blocks.ts'
import { addSpanMarks } from './write-spans.ts'
import { contentOrder, tableFormat } from './write-table.ts'
import { trimLineEnds } from './write-trim.ts'
import { type Asked, EARLY_FINAL, EARLY_PAIRS, LATE_PAIRS, NO_PAIRS, pairEscapes, pairReach } from './write-pairs.ts'
import { escapeKinds, escapePartnerClosers, leavesKindBare, locateTexts, type TextStarts } from './write-kinds.ts'
import { BRACED_MARKS, BRACED_NODES } from './inline-tables.ts'
import {
  type Check, compareBlocks, createCheck, escapeAt, escapeCappedRun, escapeOpeners, exhausted, extendChains, openerOffsets,
  simpleSpanForest, earlyLoneNoteBrackets, earlyTextNoteClosers, holdsCaretPair,
  parseChunk, parseWritten,
} from './write-check.ts'
import { type Wrap } from './layout.ts'
import { isSecondHalf, unitBytes, utf8Length } from './positions.ts'
import { isAsciiPunctuation } from './unicode.ts'
import { createWriter, type LossMark, lose, markLosses, rollBackLosses, type Writer, type WriterFacts } from './write-state.ts'
import { createPlan, notePlaces, type Plan } from './write-plan.ts'
import { plainParagraph } from './write-plain.ts'
import { type ExtensionDefinition } from './extensions/types.ts'
import { sourceCoreEquivalent, withCoreInlines } from './write-extension-source.ts'
import { caretLineEscapes } from './write-carets.ts'

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
  for (const wrap of contentOrder(entry.wraps ?? [])) {
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

/** A form a comparison asked for: the node keeps it whatever stands before it. */
function setForm(w: Writer, node: Node): void {
  w.glued.delete(node)
  w.forms.set(node, (w.forms.get(node) ?? 0) + 1)
}

/** Takes over what a comparison asked for. Returns false where it asked for no change. */
function applyChanges(w: Writer, check: Check): boolean {
  // C2-W-091: the escapes are placed in the spelling of the nodes. Where a node first takes its other
  // form, the pass starts again in that spelling, so no escape of the old one stays.
  if (check.forms.some((node) => !w.forms.has(node))) {
    w.escapes.clear()
    w.attempts.clear()
    for (const node of check.forms) setForm(w, node)
    return true
  }
  for (const [node, at] of check.retracted) removeEscape(w, node, at)
  addEscapes(w, check.escapes)
  for (const node of check.forms) setForm(w, node)
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
  // C2-W-155: an indented block reads back only with the blocks below it down to the typed-opener paragraph.
  if (joinsIndentedRun(w, before)) return true
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

/**
 * C2-W-125: once every other form lost a node, a trial that gives the tree with every placed escape is taken, though
 * it changes nothing with the text to its right bare, as the caret of `^[a\^[b][[b]\]]` that the closer behind it needs.
 */
function givesTree(
  w: Writer, group: readonly Node[], first: boolean, placed: Map<TextNode, number[]>, node: TextNode, at: number,
): boolean {
  const all = new Map(placed)
  all.set(node, [...(placed.get(node) ?? []), at].sort((a, b) => a - b))
  const parsed = groupTree(w, group, first, all).children
  return parsed.length === group.length && parsed.every((block, index) => writerEqual(w, group[index]!, block))
}

/** Whether a trial escape changes the tree with earlier escapes in place, or gives it in a form of `wholeTrials`. */
function isAsked(w: Writer, group: readonly Node[], first: boolean, node: TextNode, at: number): boolean {
  const placed = w.escapes
  const lines = w.lines
  const lead = w.lead
  const leadSkip = w.leadSkip
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
  const asked = !treesEqual(groupTree(w, group, first, escaped), without) || (w.wholeTrials && givesTree(w, group, first, placed, node, at))
  w.escapes = placed
  w.lines = lines
  w.lead = lead
  w.leadSkip = leadSkip
  w.starts.clear()
  for (const [key, value] of starts) w.starts.set(key, value)
  return asked
}

// The trials a pass tests together at most: the subsets grow as 2^n, and a group that needs more loses the node as before.
const MAX_RETESTED_TRIALS = 8

/** Records each trial and escape a `wholeTrials` pass asks for once, in the order the rounds asked for it. */
function logTrials(w: Writer, trials: readonly [TextNode, number][]): void {
  const log = w.trialLog
  if (log === null) return
  for (const [node, at] of trials) {
    // Past the cap the pass is not retested, so the log stops growing and stays short.
    if (log.length > MAX_RETESTED_TRIALS) return
    if (!log.some((entry) => entry[0] === node && entry[1] === at)) log.push([node, at])
  }
}

/**
 * C2-W-125: each trial was tested with only the escapes placed before it, so one that needs a closer escape placed in
 * a later round was dropped (the caret of `^[\[^[a\^[b][[b]\]]`), and one that a later escape makes harmful was kept
 * (the bracket of ` [^` in `^[ [^[b][[^b]\[]]`). Where the pass then loses a node, the trials are tested again
 * together with the other escapes the pass asked for, fewest first, and the first set that gives the tree is taken.
 */
function retestTrials(w: Writer, group: readonly Node[], first: boolean, check: Check): void {
  const log = w.trialLog
  if (check.escapes.length + check.forms.length + check.retracted.length > 0 || check.losses.length === 0) return
  if (log === null || w.trialsRetested || log.length === 0 || log.length > MAX_RETESTED_TRIALS) return
  w.trialsRetested = true
  const placed = w.escapes
  const base = new Map<TextNode, number[]>()
  for (const [node, offsets] of placed) {
    base.set(node, offsets.filter((at) => !log.some((entry) => entry[0] === node && entry[1] === at)))
  }
  const lines = w.lines
  const lead = w.lead
  const leadSkip = w.leadSkip
  const starts = new Map(w.starts)
  let found = -1
  const subsets = [...Array(1 << log.length).keys()].sort((a, b) => bitCount(a) - bitCount(b) || a - b)
  for (const subset of subsets) {
    const escapes = new Map(base)
    log.forEach(([node, at], bit) => {
      if ((subset & (1 << bit)) !== 0) escapes.set(node, [...(escapes.get(node) ?? []), at].sort((a, b) => a - b))
    })
    const parsed = groupTree(w, group, first, escapes).children
    if (parsed.length === group.length && parsed.every((block, index) => writerEqual(w, group[index]!, block))) {
      found = subset
      break
    }
  }
  w.escapes = placed
  w.lines = lines
  w.lead = lead
  w.leadSkip = leadSkip
  w.starts.clear()
  for (const [key, value] of starts) w.starts.set(key, value)
  if (found < 0) return
  log.forEach((escape, bit) => {
    const isPlaced = placed.get(escape[0])?.includes(escape[1]) === true
    if ((found & (1 << bit)) !== 0 && !isPlaced) check.escapes.push(escape)
    else if ((found & (1 << bit)) === 0 && isPlaced) check.retracted.push(escape)
  })
}

function bitCount(value: number): number {
  let count = 0
  for (let rest = value; rest !== 0; rest &= rest - 1) count++
  return count
}

/** C2-W-088: backtick trials that the test kept stopped a code span of the parse, which reports the backtick kind. */
function keepCodeTrial(check: Check): void {
  const kept = (trial: [TextNode, number]): boolean => check.codeTrials.has(trial) && check.escapes.includes(trial)
  if (check.trials.length > 0 && check.trials.every(kept)) check.trials = []
}

/** C2-W-088 (CC-1568): every opener of each reported kind; a backslash of a C2-W-125 closer repair gives no kind. */
function escapeReportedKinds(w: Writer, check: Check, group: readonly Node[]): void {
  // The comparison can reach a missing tree node before it reaches a construct in that
  // node's text. If the read-back parse opened a construct on the trial's text brace,
  // it is a reported opener rather than a C2-W-125 trial.
  const located = check.source === null || check.trials.length === 0 ? undefined : locateTexts(check, group, check.source)
  if (located !== undefined) check.trials = check.trials.filter(([node, at]) => !trialOpensBracedConstruct(check, node, at, located))
  escapeKinds(check, group, w.closerKinds ? undefined : new Set([...check.closers, ...check.readOn]), located)
  escapePartnerClosers(check, group)
}

function trialOpensBracedConstruct(check: Check, text: TextNode, at: number, { bytes, starts }: TextStarts): boolean {
  const kind = BRACED_MARKS.indexOf(text.value[at + 1] ?? '')
  const type = kind < 0 ? undefined : BRACED_NODES[kind]
  const source = check.source
  const parsed = check.w.parsed
  if (text.value[at] !== '{' || type === undefined || source === null || parsed === null) return false
  const located = starts.get(text)
  if (located === undefined) return false
  const [start, escapes] = located
  let before = 0
  while (escapes[before] !== undefined && escapes[before]! < at) before++
  const sourceAt = start + at + before
  if (source[sourceAt] !== '{') return false
  const byte = bytes[sourceAt]!
  const pending: Node[] = [...parsed.children]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === type && node.pos?.startOffset === byte) return true
    pushAll(pending, childNodes(node))
  }
  return false
}

/**
 * One round of the test of C2-W-089 on the group `group`, which stands in `w.lines`. Returns
 * false when the group reads back as its blocks. C2-W-088 places all escapes reported by the same read-back parse.
 */
function settle(w: Writer, document: DocumentNode, group: readonly Node[], first: boolean, initial: boolean): boolean {
  const check = compareWithLinkFallback(w, document, group, first, initial)
  // C2-W-125 tries to form a missing node separately from the constructs C2-W-088 found in the
  // read-back parse. A lone ineffective trial takes no escape. Multiple trials can work together.
  dropEarlyTrials(check)
  logTrials(w, check.trials)
  let dropped = dropIdleTrial(w, check, group, first)
  dropped = dropIdleLeads(w, group, first, check) || dropped
  deferRepairs(check)
  dropped = dropIdleTrials(w, check, group, first) || dropped
  if (dropped && check.escapes.length + check.forms.length + check.retracted.length === 0) return true
  keepCodeTrial(check)
  dropLineDuplicates(check)
  if (w.kindRounds) escapeReportedKinds(w, check, group)
  extendChains(check)
  extendForms(w, check, group)
  extendClosers(w, check, group)
  escapeCappedRun(check)
  dropEscapesAfterConstruct(w, group, first, check)
  retestTrials(w, group, first, check)
  logTrials(w, check.escapes)
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
 * C2-W-088, C2-W-125 case five: the first round writes the brackets of link text bare. A bare closer there can let a
 * construct form, as the link's closer taking a text `[` below it; where the round reports one, it escapes its kind
 * beside the case backslash (carve#6656) and the rounds go on from the bare text. Otherwise, or where the round asks
 * for a change inside a link, the brackets of link text without a partner take their backslash (`linkFallback`) and
 * the round is compared again.
 */
function compareWithLinkFallback(w: Writer, document: DocumentNode, group: readonly Node[], first: boolean, initial: boolean): Check {
  const attempts = initial && w.sawLink && !w.linkFallback ? copyAttempts(w.attempts) : null
  const check = compareGroup(w, document, group, first)
  if (attempts === null) return check
  if (reportsConstruct(check, group) && !linkRepairRequested(group, check)) {
    // C2-W-125: the case backslash is placed in this round, beside the kind escapes (carve#6656 ruling A, carve#6681).
    w.linkFallback = true
    return check
  }
  w.attempts = attempts
  w.linkFallback = true
  resetLines(w)
  writeBlocks(w, group, '', 0, false)
  return compareGroup(w, document, group, first)
}

/**
 * Whether the parse holds a construct the tree does not hold. In a group with a caret pair, case eight can keep a text
 * `^[` bare, so there only a construct on another text `[` counts.
 */
function reportsConstruct(check: Check, group: readonly Node[]): boolean {
  if (check.constructs.size === 0) return false
  if (!group.some(holdsCaretPair)) return true
  for (const [node, at] of check.constructs) if (node.value[at] === '[' && node.value[at - 1] !== '^') return true
  return false
}

function copyAttempts(attempts: Writer['attempts']): Writer['attempts'] {
  const copy: Writer['attempts'] = new Map()
  for (const [node, attempt] of attempts) copy.set(node, { step: attempt.step, escapes: [...attempt.escapes] })
  return copy
}

/** The rounds start from the bare brackets of link text, so the backslashes an earlier write of them added go. */
function dropLinkFallback(w: Writer): void {
  for (const [node, placed] of w.linkPlaced) {
    const current = w.escapes.get(node)
    if (current !== undefined && current.some((at) => placed.has(at))) w.escapes.set(node, current.filter((at) => !placed.has(at)))
  }
  w.linkPlaced.clear()
}

/** Whether the round asks for an escape, a form or a loss in a link or below one. */
function linkRepairRequested(group: readonly Node[], check: Check): boolean {
  const asked = new Set<Node>()
  for (const [node] of check.escapes) asked.add(node)
  for (const [node] of check.losses) asked.add(node)
  for (const node of check.forms) asked.add(node)
  if (asked.size === 0) return false
  const pending: [Node, boolean][] = group.map((node) => [node, false])
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const inside = item[1] || item[0].type === 'link'
    if (inside && asked.has(item[0])) return true
    for (const child of childNodes(item[0])) pending.push([child, inside])
  }
  return false
}

/** A reported construct's opener can settle the tree before repairs beside its marks are needed. */
function dropEscapesAfterConstruct(w: Writer, group: readonly Node[], first: boolean, check: Check): void {
  if (check.constructs.size === 0 || check.escapes.length <= check.constructs.size || check.forms.length > 0 ||
    ![...check.constructs].every(([node, at]) => node.value?.slice(at, at + 2) === '{-' || node.value?.slice(at, at + 2) === '{+')) return
  const kept = check.escapes.filter((escape) => check.constructs.has(escape))
  if (kept.length === 0) return
  const savedEscapes = w.escapes
  const savedLines = w.lines
  const savedLead = w.lead
  const savedStarts = new Map(w.starts)
  const candidates = new Map(savedEscapes)
  for (const [node, at] of kept) candidates.set(node, [...(candidates.get(node) ?? []), at].sort((a, b) => a - b))
  const parsed = groupTree(w, group, first, candidates).children
  const equal = parsed.length === group.length && parsed.every((node, at) => writerEqual(w, group[at]!, node))
  w.escapes = savedEscapes
  w.lines = savedLines
  w.lead = savedLead
  w.starts.clear()
  for (const [key, value] of savedStarts) w.starts.set(key, value)
  if (equal) check.escapes = kept
}

function dropIdleTrial(w: Writer, check: Check, group: readonly Node[], first: boolean): boolean {
  const trial = check.trials.length === 1 ? check.trials[0] : undefined
  if (trial === undefined || isAsked(w, group, first, trial[0], trial[1])) return false
  const [node, at] = trial
  const place = check.escapes.findIndex((escape) => escape[0] === node && escape[1] === at)
  if (place >= 0) check.escapes.splice(place, 1)
  check.marks.get(node)?.delete(at)
  return true
}

/**
 * C2-W-088, C2-W-125: a round whose parse holds a construct the tree does not hold escapes the openers of such
 * constructs and their kinds. The escape of a closer that ended a node early, or that the content took from the text
 * behind it, or lengthens a node, repairs what that construct can cause. It waits for the parse
 * after the construct's escape.
 */
function deferRepairs(check: Check): void {
  if (check.constructs.size === 0) return
  const deferred = (escape: [TextNode, number]): boolean =>
    !check.constructs.has(escape) && (check.closers.has(escape) || check.behind.has(escape) ||
      (check.lengthening.has(escape) && !check.pairedLengthening.has(escape)))
  for (const escape of check.escapes.filter(deferred)) {
    check.escapes.splice(check.escapes.indexOf(escape), 1)
    check.marks.get(escape[0])?.delete(escape[1])
  }
  check.earlyClosers = check.earlyClosers.filter(([, escape]) => check.escapes.includes(escape))
}

/**
 * C2-W-125, C2-W-088: a probe of an outer content asks for the trials of the nodes inside it together, so the test of a
 * lone trial above does not reach them. A content-start trial among several is tested on its own in the group, like a
 * lone one: where it does not change the parse, it is no backslash of the procedure and is taken out.
 */
function dropIdleLeads(w: Writer, group: readonly Node[], first: boolean, check: Check): boolean {
  if (check.trials.length < 2 || check.trials.length > 4 || check.leadTrials.size === 0) return false
  let dropped = false
  for (const trial of check.trials) {
    if (!check.leadTrials.has(trial) || isAsked(w, group, first, trial[0], trial[1])) continue
    const place = check.escapes.indexOf(trial)
    if (place >= 0) check.escapes.splice(place, 1)
    check.marks.get(trial[0])?.delete(trial[1])
    dropped = true
  }
  if (dropped) check.trials = check.trials.filter((trial) => check.escapes.includes(trial))
  return dropped
}

/**
 * C2-W-125: a round can place trials for several nodes of one stretch, where the first one already forms the others
 * (the brace before the tag of `x{#a\_--}` forms the dash behind it). A trial that changes nothing beside the other
 * escapes of the round is no backslash of a case and is taken out. Only where the parse reads no node the tree lacks,
 * as a strong of the tree beside the stretch (carve#6687): a construct it reports gives its kind (C2-W-088), and the
 * rounds after it decide those trials.
 */
function dropIdleTrials(w: Writer, check: Check, group: readonly Node[], first: boolean): boolean {
  if (check.trials.length < 2 || check.trials.length > MAX_RETESTED_TRIALS || !readsNoOtherNode(check.w.parsed, group)) return false
  const placed = w.escapes
  const lines = w.lines
  const lead = w.lead
  const leadSkip = w.leadSkip
  const starts = new Map(w.starts)
  const base = new Map<TextNode, number[]>()
  for (const [node, offsets] of placed) {
    base.set(node, offsets.filter((at) => !check.retracted.some((escape) => escape[0] === node && escape[1] === at)))
  }
  const withEscapes = (escapes: readonly [TextNode, number][]): Map<TextNode, number[]> => {
    const all = new Map(base)
    for (const [node, at] of escapes) all.set(node, [...(all.get(node) ?? []), at].sort((a, b) => a - b))
    return all
  }
  let dropped = false
  // The tree with every escape of the round changes only where a trial is taken out, and then into the tree without it.
  let all = groupTree(w, group, first, withEscapes(check.escapes))
  // The later trial goes first, so the earlier one, which the rounds of C2-W-088 reach first, is kept.
  for (const trial of [...check.trials].reverse()) {
    const without = groupTree(w, group, first, withEscapes(check.escapes.filter((escape) => escape !== trial)))
    if (!treesEqual(all, without)) continue
    all = without
    check.escapes.splice(check.escapes.indexOf(trial), 1)
    check.marks.get(trial[0])?.delete(trial[1])
    check.trials = check.trials.filter((other) => other !== trial)
    dropped = true
  }
  w.escapes = placed
  w.lines = lines
  w.lead = lead
  w.leadSkip = leadSkip
  w.starts.clear()
  for (const [key, value] of starts) w.starts.set(key, value)
  return dropped
}

/**
 * Whether each leaf block of `parsed` holds, beside text and breaks, only inline nodes that equal nodes of the same leaf
 * of the tree, in their order: a node read elsewhere, as a span on another bracket, is a construct the tree lacks.
 */
function readsNoOtherNode(parsed: DocumentNode | null, group: readonly Node[]): boolean {
  if (parsed === null) return false
  const read = leafBlocks(parsed.children)
  const tree = leafBlocks(group)
  if (read.length !== tree.length) return false
  return read.every((leaf, index) => {
    const held = childNodes(tree[index]!)
    let at = 0
    for (const node of childNodes(leaf)) {
      if (node.type === 'text' || isBreak(node)) continue
      while (at < held.length && !treesEqual(held[at]!, node)) at++
      if (at++ === held.length) return false
    }
    return true
  })
}

/** C2-W-125, case eight: the trials of a round that escaped an early note closer read the note it undoes. */
function dropEarlyTrials(check: Check): void {
  if (!check.earlyCloser) return
  for (const trial of check.trials) {
    const place = check.escapes.indexOf(trial)
    if (place >= 0) check.escapes.splice(place, 1)
    check.marks.get(trial[0])?.delete(trial[1])
  }
  check.trials = []
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

/**
 * C2-W-093, C2-W-010: a braced emphasis or strong whose content closer took a backslash gives the same backslash to
 * each braced node of the group with the same content, so the rounds do not grow with the number of such nodes.
 */
function extendClosers(w: Writer, check: Check, group: readonly Node[]): void {
  if (check.earlyClosers.length === 0) return
  const keys = w.contentKeys
  const asked = new Map<string, [Node, number[], number]>()
  const shapes = new Set<string>()
  for (const [owner, [text, at]] of check.earlyClosers) {
    const path = pathTo(owner, text)
    if (path === null) continue
    asked.set(contentKey(owner, keys), [owner, path, at])
    shapes.add(shapeOf(owner))
  }
  const pending = [...group]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    forEachSlot(node, (children) => { for (const child of children) pending.push(child) })
    const found = writtenBraced(w, node) && shapes.has(shapeOf(node)) ? asked.get(contentKey(node, keys)) : undefined
    const text = found === undefined || found[0] === node ? null : follow(node, found[1])
    if (text !== null && escapeAt(check, text, found![2])) check.closers.add(check.escapes[check.escapes.length - 1]!)
  }
}

function shapeOf(node: Node): string {
  return `${node.type} ${childNodes(node).length}`
}

function writtenBraced(w: Writer, node: Node): boolean {
  return (node.type === 'emphasis' || node.type === 'strong') && (w.bracedAnyway.has(node) || (w.forms.get(node) ?? 0) > 0)
}

/** The type and fields of `node` and of everything below it, without positions. */
function contentKey(node: Node, keys: Map<Node, string>): string {
  const known = keys.get(node)
  if (known !== undefined) return known
  const fields: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(node)) if (name !== 'pos' && name !== 'children') fields[name] = value
  const children = 'children' in node ? (node.children as Node[]).map((child) => contentKey(child, keys)).join(',') : ''
  const key = `${JSON.stringify(fields)}[${children}]`
  keys.set(node, key)
  return key
}

function pathTo(from: Node, text: TextNode): number[] | null {
  if (from === text) return []
  const children = 'children' in from ? from.children as Node[] : []
  for (let at = 0; at < children.length; at++) {
    const rest = pathTo(children[at]!, text)
    if (rest !== null) return [at, ...rest]
  }
  return null
}

function follow(from: Node, path: readonly number[]): TextNode | null {
  let node: Node | undefined = from
  for (const at of path) node = node !== undefined && 'children' in node ? (node.children as Node[])[at] : undefined
  return node?.type === 'text' ? node : null
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

/** The nodes of `group` and of everything below them, in a fixed order. */
function groupNodes(group: readonly Node[]): Node[] {
  const nodes: Node[] = []
  const pending = [...group]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    nodes.push(node)
    forEachSlot(node, (children) => { for (const child of children) pending.push(child) })
  }
  return nodes
}

/**
 * C2-W-133: the repair state of this group, including attempts that can change its next round. A node without
 * escapes, form, attempt or loss adds nothing; the ids keep the records of the others apart.
 */
function repairKey(w: Writer, ids: Map<Node, number>, nodes: readonly Node[]): string {
  let states = ''
  for (const node of nodes) {
    const escapes = node.type === 'text' ? w.escapes.get(node) : undefined
    const form = w.forms.get(node)
    const attempt = w.attempts.get(node)
    const lost = w.lost.has(node)
    if (escapes === undefined && form === undefined && attempt === undefined && !lost) continue
    let tried = ''
    if (attempt !== undefined) for (const [text, at] of attempt.escapes) tried += `${nodeId(ids, text)}.${at},`
    states += `${nodeId(ids, node)}:${escapes?.join(',') ?? '-'}:${form ?? '-'}:${attempt?.step ?? '-'}:${tried}:${lost ? 1 : 0};`
  }
  return `${JSON.stringify([w.lines, w.blankFirst, w.losses.entries.length])}${states}`
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
  /** The end of the group that `nodes` and `deep` were taken for. */
  end: number
  nodes: Node[]
  deep: boolean
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
  const key = repairKey(w, history.ids, history.nodes)
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
  for (const node of w.glued) if (w.forms.get(node) === 1) w.forms.delete(node)
  w.glued.clear()
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
function writerEqual(w: Writer, expected: Node, actual: Node): boolean {
  if (treesEqual(expected, actual) || sourceCoreEquivalent(expected, actual)) return true
  const spelled = w.lineFeedValues ? withSpelledValues(expected) : undefined
  if (spelled !== undefined) return writerEqual(w, spelled, actual)
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
    if (plain !== null && writerEqual(w, group[0]!, plain)) return true
  }
  // Equality disregards positions (C2-A-161), so the readback builds none.
  const parsed = parseChunk(w, `${first ? '' : '\n'}${w.lines.join('\n')}\n`, w.linkKeys, false).children
  return parsed.length === group.length && parsed.every((node, at) => writerEqual(w, group[at]!, node))
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
      w.glued.delete(node)
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
  if (!writePlanned(w, run, group, plan, replaced)) return false
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

/** Writes the group with the planned escapes; false, with the escapes taken back, where the repair decides a tag brace. */
function writePlanned(w: Writer, run: WriterRun, group: readonly Node[], plan: Plan,
  replaced: readonly [TextNode, number[] | undefined][]): boolean {
  if (replaced.length > 0) {
    resetLines(w)
    writeBlocks(w, group, '', 0, false)
  }
  if (!keepsNameBrace(w, plan)) return true
  restoreEscapes(w, replaced)
  noteReason(run, 'sigil end', '')
  return false
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

/**
 * C2-W-125 six, C2-W-091: the repair keeps a backslash its rounds placed beside another construct. A bare brace before a
 * tag whose stretch holds the plan's `\-` behind the name stays bare only as `prunableOpener` takes its backslash: no
 * other text backslash in the group. Names beside a mark of the tree need the same. Otherwise the repair decides.
 */
function keepsNameBrace(w: Writer, plan: Plan): boolean {
  if (plan.nameEscapes === 0) return false
  let escapes = 0
  for (const list of plan.escapes.values()) escapes += list.length
  if (plan.namesBesideMarks && escapes !== plan.nameEscapes) return true
  for (const line of w.lines) {
    for (let at = line.indexOf('{#'); at >= 0; at = line.indexOf('{#', at + 2)) {
      const close = line.indexOf('}', at + 2)
      const dash = line.indexOf('\\-', at + 2)
      if (line[at - 1] === '\\' || close < 0 || dash < 0 || dash > close) continue
      if (inHyphenRun(line, dash) || escapes !== bracedNameEscapes(line, at - 1, close)) return true
    }
  }
  return false
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
  w.reportedBraceKinds.clear()
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
  if (writeSimpleSpanForest(w, run, group)) return from + group.length
  return writeOrdinaryGroup(w, run, document, from, first, group)
}

function writeOrdinaryGroup(w: Writer, run: WriterRun, document: DocumentNode, from: number, first: boolean,
  group: readonly Node[]): number {
  addEscapes(w, earlyTextNoteClosers(group).filter(([node, at]) => !(w.escapes.get(node) ?? []).includes(at)))
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

/** A formable forest with only unmatched bracket openers has one source and no structural repair choice. */
function writeSimpleSpanForest(w: Writer, run: WriterRun, group: readonly Node[]): boolean {
  if (run.path !== 'plan') return false
  const knownEscapes = simpleSpanForest(group)
  if (knownEscapes.size === 0) return false
  for (const [node, offsets] of knownEscapes) w.escapes.set(node, offsets)
  resetLines(w)
  writeBlocks(w, group, '', 0, false)
  run.stats.planned++
  run.stats.work.push([w.lines.reduce((total, line) => total + line.length + 1, 0), 0])
  return true
}

/** The choices of the group a pair round can take back; the losses of the document are a mark, not a copy. */
interface SavedGroup {
  end: number
  lines: string[]
  escapes: Map<TextNode, number[]>
  reportedBraceKinds: Set<string>
  forms: Map<Node, number>
  glued: Set<Node>
  attempts: Writer['attempts']
  blankFirst: boolean
  losses: LossMark
  parsed: DocumentNode | null
}

function saveGroup(w: Writer, end: number): SavedGroup {
  return {
    end, lines: [...w.lines], escapes: new Map([...w.escapes].map(([node, at]) => [node, [...at]])),
    reportedBraceKinds: new Set(w.reportedBraceKinds), forms: new Map(w.forms),
    glued: new Set(w.glued), attempts: new Map(w.attempts), blankFirst: w.blankFirst, losses: markLosses(w), parsed: w.parsed,
  }
}

function restoreGroup(w: Writer, saved: SavedGroup): number {
  w.lines = saved.lines
  w.escapes = saved.escapes
  w.reportedBraceKinds = saved.reportedBraceKinds
  w.forms = saved.forms
  w.glued = saved.glued
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
  dropLinkFallback(w)
  // A bracket left open in a bracketed node's content would consume that node's closer.
  // Collect these independent escapes before the readback instead of discovering one nest per parse.
  const group = document.children.slice(from, groupEnd(w, document.children, from))
  for (const [text, offsets] of simpleSpanForest(group)) {
    const placed = w.escapes.get(text) ?? []
    w.escapes.set(text, [...new Set([...placed, ...offsets])].sort((a, b) => a - b))
  }
  addEscapes(w, [...caretLineEscapes(group)].map(([node]) => [node, 0] as [TextNode, number])
    .filter(([node]) => !(w.escapes.get(node) ?? []).includes(0)))
  addEscapes(w, earlyLoneNoteBrackets(w, group).filter(([node, at]) => !(w.escapes.get(node) ?? []).includes(at)))
  const saved = w.kindRounds ? saveGroup(w, groupEnd(w, document.children, from)) : null
  const end = repairOnce(w, document, from, first, reported)
  if (saved === null || w.losses.entries.length === reported) return end
  restoreGroup(w, saved)
  const before = saveGroup(w, saved.end)
  // C2-W-005: where that loses a node, the closer repairs give their kind too, the smallest departure that keeps it.
  w.closerKinds = true
  try {
    const kinds = repairOnce(w, document, from, first, reported)
    if (w.losses.entries.length === reported) return kinds
  } finally {
    w.closerKinds = false
  }
  // C2-W-088: where the rounds by kind lose a node, the rounds of the reported openers only give the form.
  restoreGroup(w, before)
  // A restored group holds the maps of its snapshot, so each later restore reads a snapshot of its own.
  const unrepaired = saveGroup(w, saved.end)
  w.kindRounds = false
  try {
    const openers = repairOnce(w, document, from, first, reported)
    if (w.losses.entries.length === reported) return openers
  } finally {
    w.kindRounds = true
  }
  // C2-W-125: where every form loses a node, a trial that gives the tree only with a backslash behind it is kept.
  let last = unrepaired
  // The pass by kinds can ask for a trial whose kind escapes then lose the node; the pass after it tests it too.
  w.trialLog = []
  try {
    for (const kinds of [true, false]) {
      restoreGroup(w, last)
      last = saveGroup(w, saved.end)
      w.wholeTrials = true
      w.trialsRetested = false
      w.kindRounds = kinds
      try {
        const trials = repairOnce(w, document, from, first, reported)
        if (w.losses.entries.length === reported) return trials
      } finally {
        w.wholeTrials = false
        w.kindRounds = true
      }
    }
  } finally {
    w.trialLog = null
  }
  restoreGroup(w, last)
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
  w.cappedRuns = []
  w.contentKeys.clear()
  const history: RepairHistory = { ids: new Map(), end: -1, nodes: [], deep: false, recent: [], seen: new Set(), rounds: 0, budget: 0 }
  w.linkFallback = false
  w.sawLink = false
  try {
    for (let round = 0; ; round++) {
      const end = groupEnd(w, nodes, from)
      const group = nodes.slice(from, end)
      resetLines(w)
      writeBlocks(w, group, '', 0, false)
      if (w.lines.length === 0) return end
      takeGroupFacts(history, group, end)
      if (history.deep) {
        refuseDeepGroup(w, group)
        return end
      }
      if (repeatedRepair(w, group, history)) return end
      if (!settle(w, document, group, first && !w.blankFirst, round === 0) && !exhausted(w)) {
        finishRounds(w, group, first && !w.blankFirst, reported)
        return end
      }
    }
  } finally {
    w.linkFallback = true
  }
}

/** The tree does not change between rounds, so the depth and nodes of a group are taken once. */
function takeGroupFacts(history: RepairHistory, group: readonly Node[], end: number): void {
  if (history.end === end) return
  history.end = end
  history.deep = beyondSourceDepth(group)
  history.nodes = history.deep ? [] : groupNodes(group)
}

/** The group reads back or asks for no more change: the escapes the rounds placed are cut to those it needs. */
function finishRounds(w: Writer, group: readonly Node[], first: boolean, reported: number): void {
  trimCappedRuns(w, group, first)
  if (w.losses.entries.length === reported) reportUnread(w, group)
  pruneGroupEscapes(w, group, first)
}

/**
 * C2-I-118: the rounds would place the escapes behind a capped opener one per round and stop at the first round that
 * reads back. Those placed at once are kept up to the shortest run, in their order, with which the group reads back.
 */
function trimCappedRuns(w: Writer, group: readonly Node[], first: boolean): void {
  const placed = placedCappedRuns(w)
  w.cappedRuns = []
  if (placed.length === 0 || w.parsed === null || !matchesGroup(w.parsed.children, group)) return
  const written = (keep: number): DocumentNode => {
    dropEscapes(w, placed.slice(keep))
    resetLines(w)
    writeBlocks(w, group, '', 0, false)
    return parseChunk(w, `${first ? '' : '\n'}${w.lines.join('\n')}\n`)
  }
  let parsed = w.parsed
  const readsBack = (keep: number): boolean => {
    const trial = written(keep)
    addEscapes(w, placed.slice(keep))
    if (!matchesGroup(trial.children, group)) return false
    parsed = trial
    return true
  }
  // The rounds stop a few escapes short of the end of the construct at most, so the search starts there and widens.
  let low = 0
  let high = placed.length
  for (let step = 1; low < high && !exhausted(w); step *= 2) {
    const keep = Math.max(low, high - step)
    if (!readsBack(keep)) {
      low = keep + 1
      break
    }
    high = keep
  }
  while (low < high && !exhausted(w)) {
    const middle = (low + high) >> 1
    if (readsBack(middle)) high = middle
    else low = middle + 1
  }
  written(high)
  w.parsed = parsed
}

/** The escapes of `w.cappedRuns` the group still holds: a change of form clears the escapes of the group. */
function placedCappedRuns(w: Writer): [TextNode, number][] {
  const present = new Map<TextNode, Set<number>>()
  return w.cappedRuns.filter(([node, at]) => {
    let offsets = present.get(node)
    if (offsets === undefined) present.set(node, offsets = new Set(w.escapes.get(node)))
    return offsets.has(at)
  })
}

function dropEscapes(w: Writer, dropped: readonly [TextNode, number][]): void {
  const byNode = new Map<TextNode, Set<number>>()
  for (const [node, at] of dropped) byNode.set(node, (byNode.get(node) ?? new Set()).add(at))
  for (const [node, offsets] of byNode) w.escapes.set(node, (w.escapes.get(node) ?? []).filter((at) => !offsets.has(at)))
}

/** C2-W-011: a group beyond the parser's nesting limit has no spelling. */
function refuseDeepGroup(w: Writer, group: readonly Node[]): void {
  const host = group[0]
  if (host !== undefined) lose(w, host, null)
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
    if (block !== undefined && at < group.length && writerEqual(w, group[at]!, block)) continue
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

const ROOT_METADATA_LOSSES: ReadonlySet<string> = new Set(['headers', 'footers', 'abstract', 'keywords', 'fields'])

function rootMetadataLosses(document: DocumentNode, diagnostics: Diagnostic[]): void {
  // C2-W-158 leaves two fields of one node unordered; they stand in the key order of the tree, as in carve-php.
  const metadata = (document.metadata ?? {}) as Readonly<Record<string, unknown>>
  for (const name of Object.keys(metadata)) {
    if (!ROOT_METADATA_LOSSES.has(name) || metadata[name] === undefined) continue
    if (name === 'fields' && document.children.some((node) => node.type === 'frontmatter')) continue
    diagnostics.push({ code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
      message: `Carve source cannot spell root metadata.${name}`, path: `/metadata/${name}` })
  }
  // C2-W-011, C2-M-074: no source gives the document node a language or a direction (C2-M-004 imports them).
  for (const name of ['lang', 'dir'] as const) if (document[name] !== undefined) diagnostics.push({
    code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
    message: `Carve source cannot spell the document ${name}`, path: `/${name}`,
  })
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
  /** The backslashes of the source that are no case-six escape behind a name and no escaped backslash, or null. */
  others: number | null
  /** The last match of each search, so that searches from increasing offsets read the source once. */
  found: Map<string, number>
}

/** `source.indexOf(needle, from)` for `from` that do not decrease while `source` stays as it is. */
function nextIndex(scan: PruneScan, source: string, needle: string, from: number): number {
  const last = scan.found.get(needle)
  if (last !== undefined && (last < 0 || last >= from)) return last
  const at = source.indexOf(needle, from)
  scan.found.set(needle, at)
  return at
}

/** The UTF-8 offset of `at` in `source`, for `at` that do not decrease within one scan. */
function scanByte(scan: PruneScan, source: string, at: number): number {
  scan.byte += utf8Length(source.slice(scan.scanned, at))
  scan.scanned = at
  return scan.byte
}

function prunableStar(w: Writer, source: string, at: number, scan: PruneScan): boolean {
  if (w.parsed === null || !(scan.stars ??= textAfterBreak(w.parsed.children))) return false
  return starAfterBreak(w.parsed.children, scanByte(scan, source, at), null)
}

/**
 * Whether the parse opens a bare emphasis or strong at the mark behind the `\{` at `at`. Without the backslash `{` and
 * the mark read as one braced opener, so that pair cannot form and the backslash stays (C2-I-057).
 */
function opensBarePair(w: Writer, source: string, at: number, scan: PruneScan): boolean {
  if (w.parsed === null) return false
  if (barePairCache.parsed !== w.parsed) barePairCache = { parsed: w.parsed, starts: barePairStarts(w.parsed.children) }
  return barePairCache.starts.has(scanByte(scan, source, at) + 2)
}

let barePairCache: { parsed: DocumentNode | null, starts: Set<number> } = { parsed: null, starts: new Set() }

function barePairStarts(nodes: readonly Node[]): Set<number> {
  const bytes = new Set<number>()
  const pending = [...nodes]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if ((node.type === 'emphasis' || node.type === 'strong') && node.pos !== undefined) bytes.add(node.pos.startOffset)
    for (const child of childNodes(node)) pending.push(child)
  }
  return bytes
}

function prunableBracket(w: Writer, source: string, at: number, scan: PruneScan): boolean {
  if (source.startsWith('^]', at + 2)) return !reportsBracketKind(w, source, scanByte(scan, source, at))
  if (!source.startsWith('----', at + 2)) return false
  if (source[at - 1] !== '^') return true
  const close = nextIndex(scan, source, ']', at + 2)
  const lineEnd = nextIndex(scan, source, '\n', at + 2)
  return close < 0 || (lineEnd >= 0 && close > lineEnd)
}

function prunableOpener(w: Writer, source: string, at: number, scan: PruneScan): boolean {
  const next = source[at + 1]
  if (next === '*') return prunableStar(w, source, at, scan)
  // C2-W-125, case five: behind a text `^[` whose caret pairs are ordinary brackets, link text can start with a bare caret.
  if (next === '^') return source[at - 1] === '[' && !isNoteBracket(source, at - 1) && behindNoteOpener(source, at)
  if (next === '[') return prunableBracket(w, source, at, scan)
  if (next !== '{') return false
  if (source[at + 2] === '/' || source[at + 2] === '*') return !opensBarePair(w, source, at, scan)
  if (source[at + 2] !== '#') return false
  const close = nextIndex(scan, source, '}', at + 3)
  const escapedDash = nextIndex(scan, source, '\\-', at + 3)
  if (close < 0) return false
  if (escapedDash < 0 || escapedDash > close) return true
  // C2-W-125: a round that reports a construct keeps the case backslash it placed beside it (C2-W-091).
  return close - at <= LONGEST_TAG_BRACE && !inHyphenRun(source, escapedDash) &&
    otherBackslashes(w, scan, source) === bracedNameEscapes(source, at, close) + 1
}

/** The case-six escapes behind a name between the brace at `at` and its closer. */
function bracedNameEscapes(source: string, at: number, close: number): number {
  let count = 0
  for (let slash = source.indexOf('\\', at + 2); slash >= 0 && slash < close; slash = source.indexOf('\\', slash + 2)) {
    if (behindName(source, slash)) count++
  }
  return count
}

/**
 * The backslashes of `source` that escape a construct: the brace being pruned and those of other kinds. Only those in
 * text count; a code span, a destination or an attribute value holds its backslashes as they are.
 */
function otherBackslashes(w: Writer, scan: PruneScan, source: string): number {
  if (scan.others !== null) return scan.others
  const ranges: [number, number][] = []
  const pending: Node[] = [...parseChunk(w, source).children]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'text' && node.pos !== undefined) ranges.push([node.pos.startOffset, node.pos.endOffset])
    pushAll(pending, childNodes(node))
  }
  ranges.sort((a, b) => a[0] - b[0])
  const bytes = new TextEncoder().encode(source)
  let count = 0
  let range = 0
  for (let at = bytes.indexOf(92); at >= 0; at = bytes.indexOf(92, at + 2)) {
    while (range < ranges.length && ranges[range]![1] <= at) range++
    const inText = range < ranges.length && ranges[range]![0] <= at
    if (inText && bytes[at + 1] !== 92 && isAsciiPunctuation(bytes[at + 1]!)) count++
  }
  return scan.others = count
}

/** C2-W-125 case six: the backslash at `at` stands directly behind a tag or mention name, not in a hyphen run. */
function behindName(source: string, at: number): boolean {
  const next = source[at + 1]
  if (next !== '_' && next !== '.' && (next !== '-' || inHyphenRun(source, at))) return false
  let start = at
  for (;;) {
    const low = source.charCodeAt(start - 1)
    const width = low >= 0xdc00 && low <= 0xdfff && start >= 2 ? 2 : 1
    if (start - width < 0 || !NAME_CHARACTER.test(source.slice(start - width, start))) break
    start -= width
  }
  return start < at && (source[start - 1] === '#' || source[start - 1] === '@')
}

// The characters a tag or mention name can hold before its end (C2-I-090, C2-I-092).
const NAME_CHARACTER = /^[\p{L}\p{N}_-]$/u
// A longer brace keeps its backslash, so the scan of each candidate stays short.
const LONGEST_TAG_BRACE = 256

/**
 * C2-W-090, C2-W-099: the `\-` at `at` escapes a hyphen run, a kind of a later round that keeps the brace escape of
 * an earlier one (C2-W-091). Otherwise it is the case-six backslash behind the name, which gives the tree alone, so
 * the brace escape of case one goes where no other construct takes a backslash (C2-W-125, carve#6687): `x{#a\-w}`,
 * `x{#a\--w}`, but `x\{#a\---}` and `x\{#a\-w} \*s*`.
 */
function inHyphenRun(source: string, at: number): boolean {
  return source[at - 1] === '-' || (source[at + 2] === '-' && source[at + 3] === '-')
}

/**
 * C2-I-089, C2-W-091: inside the brackets of a `^[` of the line, read bare, a `[^` can be an ordinary bracket of a note
 * that reads as text, so its backslash is one the procedure placed for a reported bracket and stays.
 */
function behindNoteOpener(source: string, at: number): boolean {
  const lineStart = source.lastIndexOf('\n', at) + 1
  if (noteSpanCache.source !== source || noteSpanCache.lineStart !== lineStart) {
    noteSpanCache = { source, lineStart, inside: noteSpans(source, lineStart) }
  }
  return noteSpanCache.inside.has(at)
}

let noteSpanCache: { source: string, lineStart: number, inside: Set<number> } = { source: '', lineStart: -1, inside: new Set() }

/** The offsets of the line at `lineStart` that stand inside the brackets of a `^[`, its backslashes read as text. */
function noteSpans(source: string, lineStart: number): Set<number> {
  const inside = new Set<number>()
  const open: boolean[] = []
  let notes = 0
  for (let at = lineStart; at < source.length && source[at] !== '\n'; at++) {
    if (notes > 0) inside.add(at)
    if (source[at] === '[') {
      const note = isNoteBracket(source, at)
      open.push(note)
      if (note) notes++
    } else if (source[at] === ']' && source[at - 1] !== '\\' && open.pop() === true) {
      notes--
    }
  }
  return inside
}

/** Whether the bracket at `at` follows a caret, with or without a backslash between them. */
function isNoteBracket(source: string, at: number): boolean {
  return source[at - 1] === '^' || (source[at - 1] === '\\' && source[at - 2] === '^')
}

/**
 * C2-W-088: where the first round, which reads the text bare, reports the kind `[` in a leaf block, every run of `[`
 * there takes a backslash, which stays (C2-W-091). The bare parse reports it where a leaf block holds more nodes of one
 * type that open on a bracket than the same block of the tree.
 */
function reportsBracketKind(w: Writer, source: string, byte: number): boolean {
  if (w.parsed === null) return false
  if (bracketKindCache.source !== source || bracketKindCache.parsed !== w.parsed) {
    bracketKindCache = { source, parsed: w.parsed, leaves: bracketKindLeaves(w, source, w.parsed) }
  }
  const leaves = bracketKindCache.leaves
  let low = 0
  let high = leaves.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (leaves[middle]![1] <= byte) low = middle + 1
    else high = middle
  }
  const leaf = leaves[low]
  return leaf !== undefined && leaf[0] <= byte && leaf[2]
}

let bracketKindCache: { source: string, parsed: DocumentNode | null, leaves: [number, number, boolean][] } =
  { source: '', parsed: null, leaves: [] }

/** The leaf blocks of `parsed` by their UTF-8 range in `source`, each with whether the bare parse reports `[` in it. */
function bracketKindLeaves(w: Writer, source: string, parsed: DocumentNode): [number, number, boolean][] {
  const bare = source.replace(/\\([\s\S])/g, (escape, next: string) => (isAsciiPunctuation(next.charCodeAt(0)) ? next : escape))
  const bytes = new TextEncoder().encode(bare)
  const bareLeaves = leafBlocks(parseChunk(w, bare).children)
  const leaves = leafBlocks(parsed.children)
  return leaves.flatMap((leaf, index) => {
    if (leaf.pos === undefined) return []
    const other = bareLeaves[index]
    const reported = bareLeaves.length !== leaves.length || other === undefined || moreBracketNodes(other, leaf, bytes)
    return [[leaf.pos.startOffset, leaf.pos.endOffset, reported] as [number, number, boolean]]
  })
}

/** The leaf blocks below `nodes`, in document order. */
function leafBlocks(nodes: readonly Node[]): Node[] {
  const leaves: Node[] = []
  const pending = [...nodes].reverse()
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (isInlineParent(node)) leaves.push(node)
    else pushReversed(pending, childNodes(node))
  }
  return leaves
}

/** Whether `bare` holds more nodes of a type that open on a bracket in `bytes` (`[`, `^[`, `![`) than `tree` holds. */
function moreBracketNodes(bare: Node, tree: Node, bytes: Uint8Array): boolean {
  const counts = new Map<string, number>()
  for (const node of descendants(bare)) {
    const start = node.pos?.startOffset ?? -1
    const opens = bytes[start] === 0x5b || (bytes[start + 1] === 0x5b && (bytes[start] === 0x21 || bytes[start] === 0x5e))
    if (start >= 0 && opens) counts.set(node.type, (counts.get(node.type) ?? 0) + 1)
  }
  for (const node of descendants(tree)) {
    const count = counts.get(node.type)
    if (count !== undefined) counts.set(node.type, count - 1)
  }
  return [...counts.values()].some((count) => count > 0)
}

function descendants(root: Node): Node[] {
  const found: Node[] = []
  const pending = [...childNodes(root)]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type !== 'text') found.push(node)
    for (const child of childNodes(node)) pending.push(child)
  }
  return found
}

/** Whether `parsed` reads back as the blocks of `group`. */
function matchesGroup(parsed: readonly Node[], group: readonly Node[]): boolean {
  return parsed.length === group.length && parsed.every((node, index) => treesEqual(node, group[index]!))
}

function adjacentTexts(nodes: readonly Node[]): boolean {
  for (let at = 1; at < nodes.length; at++) if (nodes[at]!.type === 'text' && nodes[at - 1]!.type === 'text') return true
  return false
}

function isLineBreak(node: Node): boolean {
  return node.type === 'soft_break' || node.type === 'hard_break'
}

/** The inline nodes of `nodes` split at their line breaks, with the breaks. */
function inlineLines(nodes: readonly Node[]): { lines: Node[][], breaks: Node[] } {
  const lines: Node[][] = [[]]
  const breaks: Node[] = []
  for (const node of nodes) {
    if (isLineBreak(node)) {
      breaks.push(node)
      lines.push([])
    } else {
      lines[lines.length - 1]!.push(node)
    }
  }
  return { lines, breaks }
}

/** `differingRanges` for inline lists with line breaks: line by line where both have the same lines. */
function differingLines(actual: readonly Node[], expected: readonly Node[], whole: [number, number], out: [number, number][]): void {
  const a = inlineLines(actual)
  const e = inlineLines(expected)
  if (a.lines.length < 2 || a.lines.length !== e.lines.length ||
    !a.breaks.every((node, at) => treesEqual(node, e.breaks[at]!))) {
    out.push(whole)
    return
  }
  for (let at = 0; at < a.lines.length; at++) {
    const line = a.lines[at]!
    if (treesEqual({ type: 'paragraph', children: line } as Node, { type: 'paragraph', children: e.lines[at]! } as Node)) continue
    const start = line[0]?.pos?.startOffset
    const end = line[line.length - 1]?.pos?.endOffset
    out.push(start === undefined || end === undefined ? whole : [start, end])
  }
}

/** The byte ranges of the topmost nodes of `actual` that differ from `expected`; `whole` is the range of their parent. */
function differingRanges(actual: readonly Node[], expected: readonly Node[], whole: [number, number], out: [number, number][]): void {
  // An escape moves the nodes of its line, so inline lines compare as lines.
  if (actual.some(isLineBreak) || expected.some(isLineBreak)) {
    differingLines(actual, expected, whole, out)
    return
  }
  // Adjacent texts compare as one (C2-A-040), so their lists do not compare item by item.
  if (actual.length !== expected.length || adjacentTexts(actual) || adjacentTexts(expected)) {
    out.push(whole)
    return
  }
  for (let at = 0; at < actual.length; at++) {
    const a = actual[at]!
    const e = expected[at]!
    if (treesEqual(a, e)) continue
    const range: [number, number] = a.pos === undefined ? whole : [a.pos.startOffset, a.pos.endOffset]
    const inner = 'children' in a && Array.isArray(a.children) && 'children' in e && Array.isArray(e.children)
    if (inner && a.type === e.type && treesEqual({ ...a, children: [] } as Node, { ...e, children: [] } as Node)) {
      differingRanges(childNodes(a), childNodes(e), range, out)
    } else {
      out.push(range)
    }
  }
}

// C2-W-010: the batch rounds of the prune; a group they do not settle is pruned one candidate per parse.
const MAX_PRUNE_ROUNDS = 16

/** A backslash placed by a reported brace kind stays even when removing it would still read back. */
function reportedBraceEscape(w: Writer, source: string, at: number): boolean {
  if (source[at + 1] !== '{') return false
  return w.reportedBraceKinds.has('{') || w.reportedBraceKinds.has(`{${source[at + 2] ?? ''}`)
}

/** The prunable backslashes of `source`, by their offset. */
function pruneCandidates(w: Writer, source: string): number[] {
  const found: number[] = []
  const scan: PruneScan = { scanned: 0, byte: 0, stars: null, others: null, found: new Map() }
  for (let at = source.indexOf('\\'); at >= 0; at = source.indexOf('\\', at + 1)) {
    // C2-W-125, case two: a backslash directly behind a quote mark is the escape of the neighbor that decides its direction.
    if (!reportedBraceEscape(w, source, at) && source[at - 1] !== '"' && source[at - 1] !== "'" &&
      prunableOpener(w, source, at, scan)) found.push(at)
  }
  return found
}

/** `source` without the backslashes at `drop` (ascending), and the UTF-8 offset in the result where each one stood. */
function withoutBackslashes(source: string, drop: readonly number[]): { text: string, bytes: number[] } {
  const parts: string[] = []
  const bytes: number[] = []
  let from = 0
  let byte = 0
  for (const at of drop) {
    parts.push(source.slice(from, at))
    byte += utf8Length(source.slice(from, at))
    bytes.push(byte)
    from = at + 1
  }
  parts.push(source.slice(from))
  return { text: parts.join(''), bytes }
}

/** The first index of the ascending `values` whose value is at least `least`. */
function firstAtLeast(values: readonly number[], least: number): number {
  let low = 0
  let high = values.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (values[middle]! < least) low = middle + 1
    else high = middle
  }
  return low
}

interface Placed {
  kept: number[]
  waiting: number[]
  decided: Set<number>
}

/**
 * The candidates of `pending` (by offset, with their UTF-8 offsets `bytes` in the trial) inside each differing range:
 * one alone there is kept, and of several the first stays pending while the rest wait. Null where a range holds none.
 */
function placeDifferences(ranges: readonly [number, number][], pending: readonly number[], bytes: readonly number[]):
  Placed | null {
  const placed: Placed = { kept: [], waiting: [], decided: new Set() }
  for (const [start, end] of ranges) {
    const inside: number[] = []
    for (let k = firstAtLeast(bytes, start); k < bytes.length && bytes[k]! < end; k++) inside.push(pending[k]!)
    // A node that differs with no removal inside it differs from a removal elsewhere, which the rounds cannot place.
    if (inside.length === 0) return null
    if (inside.length === 1) placed.kept.push(inside[0]!)
    for (const at of inside.length === 1 ? inside : inside.slice(1)) placed.decided.add(at)
    pushAll(placed.waiting, inside.slice(1))
  }
  return placed
}

/** `source` without the backslashes at `removed`, and the backslashes at `kept` by their offset there. */
function prunedSource(source: string, removed: number[], kept: readonly number[]): { source: string, kept: Set<number> } {
  removed.sort((a, b) => a - b)
  const shifted = new Set<number>()
  let before = 0
  for (const at of [...kept].sort((a, b) => a - b)) {
    while (before < removed.length && removed[before]! < at) before++
    shifted.add(at - before)
  }
  return { source: withoutBackslashes(source, removed).text, kept: shifted }
}

/**
 * C2-W-088, C2-W-010: removes the candidates together, so one parse decides many. A candidate inside a node that
 * then differs, alone there, keeps its backslash; of several there, the first is tried alone in the next round.
 * Returns the source with the removals that read back and the backslashes it kept, or null to prune one by one.
 */
function pruneInRounds(w: Writer, group: readonly Node[], source: string, candidates: readonly number[]):
  { source: string, kept: Set<number> } | null {
  let pending = [...candidates]
  let waiting: number[] = []
  const removed: number[] = []
  const kept: number[] = []
  for (let round = 0; pending.length > 0; round++) {
    if (round === MAX_PRUNE_ROUNDS || exhausted(w)) return null
    const drop = [...removed, ...pending].sort((x, y) => x - y)
    const trial = withoutBackslashes(source, drop)
    const parsed = parseChunk(w, trial.text)
    if (matchesGroup(parsed.children, group)) {
      pushAll(removed, pending)
      pending = waiting
      waiting = []
      continue
    }
    const ranges: [number, number][] = []
    differingRanges(parsed.children, group, [0, Infinity], ranges)
    const byteOf = new Map(drop.map((at, index) => [at, trial.bytes[index]!]))
    const placed = placeDifferences(ranges, pending, pending.map((at) => byteOf.get(at)!))
    if (placed === null || placed.decided.size === 0) return null
    pushAll(kept, placed.kept)
    pushAll(waiting, placed.waiting)
    pending = pending.filter((at) => !placed.decided.has(at))
    if (pending.length === 0) {
      pending = waiting.sort((x, y) => x - y)
      waiting = []
    }
  }
  return prunedSource(source, removed, kept)
}

/** The source after the rounds of `pruneInRounds`, with the backslashes they kept; as given where they do not apply. */
function pruneBatch(w: Writer, group: readonly Node[], source: string): { source: string, kept: Set<number> } {
  const candidates = pruneCandidates(w, source)
  if (candidates.length < 2 || !matchesGroup(parseChunk(w, source).children, group)) return { source, kept: new Set() }
  const batched = pruneInRounds(w, group, source, candidates)
  if (batched === null) return { source, kept: new Set() }
  if (batched.source !== source) w.parsed = parseChunk(w, batched.source)
  return batched
}

/** C2-W-088 and C2-W-089: test candidate escapes within the group that wrote them. */
function pruneGroupEscapes(w: Writer, group: readonly Node[], first: boolean): void {
  let { source, kept } = pruneBatch(w, group, `${first ? '' : '\n'}${w.lines.join('\n')}\n`)
  let at = source.indexOf('\\')
  // A pruned backslash at `at` leaves the source before `at` as it was, so the scan goes on from there.
  const scan: PruneScan = { scanned: 0, byte: 0, stars: null, others: null, found: new Map() }
  while (at >= 0) {
    // C2-W-133: each candidate is one parse more, so the pruning counts toward the limit of the repair.
    if (exhausted(w)) {
      const host = group[0]
      if (host !== undefined) refuseRepair(w, host)
      break
    }
    // C2-W-125, case two: a backslash directly behind a quote mark is the escape of the neighbor that decides its direction.
    if (!kept.has(at) && !reportedBraceEscape(w, source, at) && source[at - 1] !== '"' && source[at - 1] !== "'" &&
      prunableOpener(w, source, at, scan)) {
      const candidate = source.slice(0, at) + source.slice(at + 1)
      const parsed = parseChunk(w, candidate)
      if (matchesGroup(parsed.children, group)) {
        source = candidate
        w.parsed = parsed
        scan.stars = null
        scan.others = null
        scan.found.clear()
        const pruned = at
        kept = new Set([...kept].map((offset) => (offset > pruned ? offset - 1 : offset)))
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

/** C2-W-050, C2-W-117: each key value that holds a line feed is written with spaces and reported at its path. */
function attributeValueLosses(document: DocumentNode, w: Writer): void {
  const pending: Node[] = [document]
  while (pending.length > 0) {
    const node = pending.pop()!
    // A lost node has its one report (`lose`); an extension written as its fallback writes none of its other slots.
    const lost = w.lost.has(node)
    const fallbackOnly = lost && (node.type === 'block_extension' || node.type === 'inline_extension')
    const lostKeys = w.lostKeys.get(node)
    node.attrs?.keyValues?.forEach(([key, value], index) => {
      if (lost || !value.includes('\n') || !isKey(key) || lostKeys?.includes(key) === true) return
      const entry: Diagnostic = { code: 'field-unspellable', severity: 'warning', channel: 'render-loss',
        message: `Carve source cannot spell the line feed in the value of the key ${key} of a ${node.type} node` }
      addFinding(w.losses, node, entry)
      w.losses.steps ??= new Map()
      w.losses.steps.set(entry, `/attrs/keyValues/${index}/1`)
    })
    if (node.type === 'include') continue
    forEachSlot(node, (children, step) => {
      if (step.startsWith('metadata/') || (fallbackOnly && step !== 'fallback')) return
      for (let at = children.length - 1; at >= 0; at--) pending.push(children[at]!)
    }, undefined, document.extensions ?? [])
  }
}

/** Locate writer losses, moving a line-feed mismatch from a wrapper to its written leaf. */
function writerDiagnostics(document: DocumentNode, w: Writer): Diagnostic[] {
  if (w.lineFeedValues) attributeValueLosses(document, w)
  const order: FindingOrder = new Map()
  return inDocumentOrder(document, locatedLosses(document, w, order), order)
}

function locatedLosses(document: DocumentNode, w: Writer, order: FindingOrder): Diagnostic[] {
  if (!w.losses.entries.some((entry, at) => entry.code === 'structure-unspellable' ||
    (entry.code === 'field-unspellable' && w.losses.nodes[at]?.type === 'comment'))) {
    const diagnostics = locateFindings(document, w.losses, order)
    rootMetadataLosses(document, diagnostics)
    return diagnostics
  }
  const candidates = lineFeedCandidates(document, w)
  // C2-W-103: locate original and added findings together, retaining ranges and include ancestry.
  const diagnostics = locateFindings(document, w.losses, order)
  suppressLineFeedWrappers(document, diagnostics, candidates.text)
  relocateCommentLosses(diagnostics, candidates.comments)
  rootMetadataLosses(document, diagnostics)
  return diagnostics
}

/** Writes a tree that is known to be valid, by the path `path`, and reports how it wrote it. */
function prepareDocumentWriter(w: Writer, document: DocumentNode, layout: WriteOptions['layout']): void {
  w.linkKeys = new Set(document.children.filter((node) => node.type === 'link_reference_definition').map((node) => node.key))
  w.lineFeedValues = holdsLineFeedValue(document)
  if (layout !== undefined && w.facts !== null) readLayout(w, w.facts, document, layout.nodes)
  readAbbreviations(w, document)
  const lead = document.children[0]
  w.leadingFrontmatter = lead?.type === 'frontmatter' && lead.attrs === undefined ? lead : null
  w.topBlocks = topPredecessors(w, document.children)
  w.openerRuns = null
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
