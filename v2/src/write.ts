// The canonical writer (spec/0.2/writer.md): a tree, and optionally the sidecar that was returned
// with it, as Carve source (C2-W-001). Blocks that a blank line separates are written and tested
// on their own (C2-W-089), so one block is written again only for its own escapes.
import { type AstNode } from './ast.ts'
import { validateTree } from './ast-validate.ts'
import { type Diagnostic, locateFindings } from './diagnostics.ts'
import { blankLinesBetween, writeBlocks } from './write-blocks.ts'
import { type Check, compareBlocks, createCheck, parseChunk } from './write-check.ts'
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

/** The node at the RFC 6901 pointer `path`, or null (C2-L-010). */
function nodeAt(document: AstNode, path: string): AstNode | null {
  let at: unknown = document
  for (const part of path.split('/').slice(1)) {
    if (typeof at !== 'object' || at === null) return null
    at = (at as Record<string, unknown>)[part]
  }
  return typeof at === 'object' && at !== null && !Array.isArray(at) ? at as AstNode : null
}

/** The string offset of the UTF-8 byte offset `bytes` of `value`, or -1 where no character starts there. */
function offsetOfByte(value: string, bytes: number): number {
  let rest = bytes
  let at = 0
  for (; rest > 0 && at < value.length; at++) {
    const code = value.charCodeAt(at)
    rest -= code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdfff ? 2 : 3
  }
  return rest === 0 ? at : -1
}

/**
 * C2-L-020, C2-L-021: the places in the text nodes of a cell at which its continuation rows
 * start. C2-L-006: a wrap that names no text node, or a place with no joining space before it,
 * contradicts the tree, and then the cell keeps no wrap.
 */
function readWraps(w: Writer, document: AstNode, cell: AstNode, entry: LayoutEntry): void {
  const points = new Map<AstNode, number[]>()
  for (const wrap of entry.wraps ?? []) {
    const node = nodeAt(document, wrap.path)
    const list = node === null ? [] : points.get(node) ?? []
    const at = node === null ? -1 : wrapPoint(node, wrap.offset, list)
    if (node === null || at < 0) {
      w.facts!.set(cell, { ...entry, wraps: [] })
      return
    }
    list.push(at)
    points.set(node, list)
  }
  w.wrapPoints ??= new Map()
  for (const [node, list] of points) w.wrapPoints.set(node, list)
}

/** The string offset of the wrap at the byte `offset` of the text `node`, behind the wraps `earlier`, or -1 where it does not fit. */
function wrapPoint(node: AstNode, offset: number, earlier: readonly number[]): number {
  const value = node.value ?? ''
  const at = node.type === 'text' ? offsetOfByte(value, offset) : -1
  if (at === 0) return earlier.length === 0 ? 0 : -1
  return at > (earlier[earlier.length - 1] ?? 0) && value[at - 1] === ' ' ? at : -1
}

function readLayout(w: Writer, document: AstNode, entries: readonly LayoutEntry[]): void {
  for (const entry of entries) {
    const node = nodeAt(document, entry.path)
    if (node === null) continue
    w.facts!.set(node, entry)
    if (entry.wraps !== undefined && entry.wraps.length > 0) readWraps(w, document, node, entry)
  }
}

/** C2-B-085: the first definition of a term wins. */
function readAbbreviations(w: Writer, document: AstNode): void {
  for (const child of document.children ?? []) {
    if (child.type === 'abbreviation_def' && !w.abbreviations.has(child.key ?? '')) w.abbreviations.set(child.key ?? '', child.expansion ?? '')
  }
}

function addEscape(w: Writer, node: AstNode, at: number): void {
  const list = w.escapes.get(node) ?? []
  let place = list.length
  while (place > 0 && list[place - 1]! > at) place--
  list.splice(place, 0, at)
  w.escapes.set(node, list)
}

function removeEscape(w: Writer, node: AstNode, at: number): boolean {
  const list = w.escapes.get(node) ?? []
  const place = list.indexOf(at)
  if (place >= 0) list.splice(place, 1)
  return place >= 0
}

/** Takes over what a comparison asked for. Returns false where it asked for no change. */
function applyChanges(w: Writer, check: Check): boolean {
  for (const [node, at] of check.retracted) removeEscape(w, node, at)
  for (const [node, at] of check.escapes) addEscape(w, node, at)
  for (const node of check.forms) w.forms.set(node, (w.forms.get(node) ?? 0) + 1)
  if (check.escapes.length + check.forms.length + check.retracted.length > 0) return true
  for (const [node, field] of check.losses) lose(w, node, field)
  return false
}

/** Whether `node` is written into one group with the block `before` above it. */
function joinsGroup(w: Writer, before: AstNode, node: AstNode): boolean {
  // C2-B-016: a description mark reads differently below a description list, also behind a blank line.
  if (node.type === 'paragraph') return before.type === 'definition_list'
  return node.type === 'comment' && blankLinesBetween(w, before, null, node, false) === 0
}

/**
 * The end of the group of blocks that starts at `from`: the blocks behind it that no blank line
 * separates from it, and what the block before reads differently.
 */
function groupEnd(w: Writer, nodes: readonly AstNode[], from: number): number {
  let end = from + 1
  while (end < nodes.length && joinsGroup(w, nodes[end - 1]!, nodes[end]!)) end++
  return end
}

/** The rounds of one group, and the escapes they asked for. */
interface Rounds {
  round: number
  escapes: [AstNode, number][]
  /** The escapes that a later change may have made needless (C2-W-088), and the one on trial. */
  doubtful: [AstNode, number][] | null
  trial: [AstNode, number] | null
}

/** The escapes of a group that are taken out on trial, each for one round. More than these keep linear time over minimality. */
const MAX_TRIALS = 32

/**
 * One round of the test of C2-W-089 on the group `group`, which stands in `w.lines`. Returns
 * false when the group reads back as its blocks and no escape is left to try.
 */
function settle(w: Writer, document: AstNode, group: readonly AstNode[], first: boolean, rounds: Rounds): boolean {
  const check = compareGroup(w, document, group, first)
  const changes = check.escapes.length + check.forms.length + check.retracted.length
  if (rounds.trial !== null) {
    const needed = changes + check.losses.length > 0
    // The escape that was taken out on trial is needed after all.
    if (needed) addEscape(w, rounds.trial[0], rounds.trial[1])
    rounds.trial = null
    if (needed) return true
  }
  if (changes === 0 && check.losses.length > 0 && first && !w.blankFirst) {
    // C2-W-005: what only line 1 reads differently is written below one blank line.
    w.blankFirst = compareGroup(w, document, group, false).losses.length === 0
    if (w.blankFirst) return false
  }
  if (rounds.doubtful === null && applyChanges(w, check)) {
    rounds.round++
    for (const escape of check.escapes) rounds.escapes.push(escape)
    return true
  }
  return tryWithout(w, rounds)
}

/** Takes the next escape of an earlier round out for one round that shows whether it is needed (C2-W-088). */
function tryWithout(w: Writer, rounds: Rounds): boolean {
  // In a group that one round settled no change came after an escape.
  rounds.doubtful ??= rounds.round > 1 ? rounds.escapes.slice(-MAX_TRIALS) : []
  for (;;) {
    const next = rounds.doubtful.pop()
    if (next === undefined) return false
    if (!removeEscape(w, next[0], next[1])) continue
    rounds.trial = next
    return true
  }
}

/**
 * Writes the group of top-level blocks that starts at `from` into `w.lines` and returns its end.
 * C2-W-089: the group is parsed again and written again until it reads back as its blocks.
 * `first` says that the group starts the document, where line 1 can open frontmatter (C2-B-161).
 */
function writeGroup(w: Writer, document: AstNode, from: number, first: boolean): number {
  const nodes = document.children!
  const rounds: Rounds = { round: 0, escapes: [], doubtful: null, trial: null }
  for (;;) {
    const end = groupEnd(w, nodes, from)
    const group = nodes.slice(from, end)
    w.lines = []
    w.lead = null
    writeBlocks(w, group, '', 0, false)
    if (w.lines.length === 0 || !settle(w, document, group, first, rounds)) return end
  }
}

function compareGroup(w: Writer, document: AstNode, group: readonly AstNode[], first: boolean): Check {
  const source = `${first ? '' : '\n'}${w.lines.join('\n')}\n`
  const check = createCheck(w)
  compareBlocks(check, group, parseChunk(source, w.abbreviations).children ?? [], document)
  return check
}

function writeDocument(w: Writer, document: AstNode): string {
  const nodes = document.children ?? []
  const out: string[] = []
  let before: AstNode | null = null
  let list: AstNode | null = null
  for (let at = 0; at < nodes.length;) {
    const from = at
    at = writeGroup(w, document, from, out.length === 0)
    if (w.lines.length === 0) continue
    if (out.length === 0 && w.blankFirst) out.push('')
    if (before !== null) for (let blank = blankLinesBetween(w, before, list, nodes[from]!, false); blank > 0; blank--) out.push('')
    for (const line of w.lines) out.push(line)
    before = nodes[at - 1]!
    for (let k = from; k < at; k++) if (nodes[k]!.type !== 'comment') list = nodes[k]!
  }
  // C2-W-022: the output ends with one line ending.
  return out.length === 0 ? '' : `${out.join('\n')}\n`
}

/** Writes a tree that is known to be valid. */
export function writeTree(document: AstNode, options: WriteOptions | undefined): WriteOutput {
  const w = createWriter(options?.layout === undefined ? null : new Map(), options?.alignTables === true)
  if (options?.layout !== undefined) readLayout(w, document, options.layout.nodes)
  readAbbreviations(w, document)
  const source = writeDocument(w, document)
  // C2-W-103: a finding of the writer has the path of its node.
  return { source, diagnostics: locateFindings(document, w.losses) }
}

/** The canonical Carve source of a tree, with what could not be written (C2-W-011). The tree is validated first. */
export function writeWithDiagnostics(document: AstNode, options?: WriteOptions): WriteOutput {
  validateTree(document)
  return writeTree(document, options)
}

/** The canonical Carve source of a tree (C2-W-001). */
export function write(document: AstNode, options?: WriteOptions): string {
  return writeWithDiagnostics(document, options).source
}
