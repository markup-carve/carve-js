// The escaping test of the writer (C2-W-088 to C2-W-091): the written blocks are parsed again
// and compared with the tree they were written from. Where the parse reads a construct that the
// tree does not hold, the opener of that construct takes a backslash; where a construct of the
// tree did not form, it takes its other spelling (C2-W-005). What neither repairs is a loss.
import { type AstNode, INLINE_PARENTS } from './ast.ts'
import { buildDocument } from './ast-blocks.ts'
import { scanBlocks } from './blocks.ts'
import { acquireInlineState, releaseInlineState } from './inline-state.ts'
import { acquireState, releaseState } from './state.ts'
import { buildTree, readInlines } from './tree.ts'
import { isAsciiPunctuation } from './write-attributes.ts'
import { spelledEnd } from './write-inline.ts'
import { type Attempt, type Writer } from './write-state.ts'

/** The tree of `src`, one block of a larger document whose abbreviations are `abbreviations`. */
export function parseChunk(src: string, abbreviations: Map<string, string>): AstNode {
  const blocks = acquireState()
  const inlines = acquireInlineState()
  try {
    scanBlocks(blocks, src)
    const root = buildTree(blocks.events, blocks.eventLength)
    readInlines(inlines, src, root, 0)
    return buildDocument(src, root, true, abbreviations).document
  } finally {
    releaseInlineState(inlines)
    releaseState(blocks)
  }
}

/** One comparison of written blocks with their parse: what it asks the next write to change. */
export interface Check {
  w: Writer
  escapes: [AstNode, number][]
  /** Escapes of an earlier round that did not help and are taken back (C2-W-088). */
  retracted: [AstNode, number][]
  forms: AstNode[]
  /** What no change repairs. It is reported when a round asks for no change. */
  losses: [AstNode, string | null][]
  /** The content under comparison stands in a table cell, where a pipe is written with a backslash. */
  cell: boolean
  /** C2-A-093: the counts of a cell are a resolution result in a table that has span marks. */
  spanMarks: boolean
}

export function createCheck(w: Writer): Check {
  return { w, escapes: [], retracted: [], forms: [], losses: [], cell: false, spanMarks: false }
}

/** The number of changes the comparison has asked for so far. */
function changes(c: Check): number {
  return c.escapes.length + c.forms.length + c.retracted.length
}

// C2-A-162: positions and the results of resolution are not compared.
const SKIPPED: readonly string[] = ['pos', 'segments', 'srcByteLength', 'stages', 'generatedId', 'resolvedAlign', 'n']
const NODE_SLOTS: readonly string[] = ['children', 'caption']
const REFERENCE_USES: readonly string[] = ['link', 'image', 'xref']
const NUMBERED: readonly string[] = ['footnote_ref', 'inline_footnote']

type Fields = Record<string, unknown>

function sameList(a: readonly unknown[], b: unknown): boolean {
  return Array.isArray(b) && a.length === b.length && a.every((item, at) => sameValue(item, b[at]))
}

/** Equality of two values that are no node lists of their own: scalars, lists and plain objects. */
function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return sameList(a, b)
  if (typeof a !== 'object' || a === null || typeof b !== 'object' || b === null || Array.isArray(b)) return a === b
  const left = a as Fields
  const right = b as Fields
  for (const name in left) if (!SKIPPED.includes(name) && left[name] !== undefined && !sameValue(left[name], right[name])) return false
  for (const name in right) if (!SKIPPED.includes(name) && right[name] !== undefined && left[name] === undefined) return false
  return true
}

/** Whether equality compares the field `name` of `node` here, apart from its node slots (C2-A-161, C2-A-162). */
function isCompared(c: Check, node: AstNode, name: string): boolean {
  if (SKIPPED.includes(name) || NODE_SLOTS.includes(name)) return false
  if (name === 'title') return !Array.isArray(node.title)
  if ((name === 'href' || name === 'src') && node.key !== undefined && REFERENCE_USES.includes(node.type)) return false
  if (name === 'number' && NUMBERED.includes(node.type)) return false
  return !(c.spanMarks && (name === 'colspan' || name === 'rowspan'))
}

function sameField(name: string, a: unknown, b: unknown): boolean {
  if (name !== 'marker' || a === undefined || b === undefined) return sameValue(a, b)
  // C2-A-058: a start of 1 is the same as none.
  const normal = (marker: unknown): Fields => {
    const fields = { ...(marker as Fields) }
    if (fields['start'] === 1) delete fields['start']
    return fields
  }
  return sameValue(normal(a), normal(b))
}

/** The name of the first field in which `e` and `a` differ, or null. */
function differingField(c: Check, e: AstNode, a: AstNode): string | null {
  const left = e as unknown as Fields
  const right = a as unknown as Fields
  for (const name in left) {
    if (left[name] !== undefined && isCompared(c, e, name) && !sameField(name, left[name], right[name])) return name
  }
  for (const name in right) {
    if (right[name] !== undefined && left[name] === undefined && isCompared(c, a, name)) return name
  }
  return null
}

function isBreak(node: AstNode | undefined): boolean {
  return node !== undefined && (node.type === 'soft_break' || node.type === 'hard_break')
}

function isEscaped(c: Check, node: AstNode, at: number): boolean {
  const same = (entry: [AstNode, number]): boolean => entry[0] === node && entry[1] === at
  if (c.escapes.some(same)) return true
  return c.w.escapes.get(node)?.includes(at) === true && !c.retracted.some(same)
}

/** Asks for a backslash before the character `at` of the text node. False where that character takes none. */
function escapeAt(c: Check, node: AstNode, at: number): boolean {
  const value = node.value ?? ''
  if (at < 0 || at >= value.length || !isAsciiPunctuation(value.charCodeAt(at)) || isEscaped(c, node, at)) return false
  c.escapes.push([node, at])
  return true
}

function isAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

/**
 * The offsets at which a line that reads as a block opener can be made text, best first (C2-W-092).
 * C2-W-099: of a hyphen run the second hyphen. An ordered marker is escaped at its delimiter,
 * since a backslash before a digit or a letter is no escape (C2-I-012).
 */
function openerOffsets(value: string): number[] {
  const offsets: number[] = []
  if (value.startsWith('--')) offsets.push(1)
  offsets.push(0)
  let end = 0
  while (end < value.length && isAlphanumeric(value.charCodeAt(end))) end++
  if (end > 0) offsets.push(end)
  return offsets
}

/** The line that starts at `nodes[from]` opened a block: escapes its opener (C2-W-090, C2-W-092). */
function escapeLineStart(c: Check, nodes: readonly AstNode[], from: number, owner: AstNode): void {
  const first = nodes[from]
  if (first?.type === 'text') for (const at of openerOffsets(first.value ?? '')) if (escapeAt(c, first, at)) return
  for (let at = from + 1; at < nodes.length && !isBreak(nodes[at]); at++) {
    if (nodes[at]!.type === 'text' && escapeAt(c, nodes[at]!, 0)) return
  }
  // The markup of the first node of the line reads as a block opener: its other spelling may not (C2-W-005).
  if (first !== undefined && hasOtherForm(c, first)) c.forms.push(first)
  else c.losses.push([first ?? owner, null])
}

function hasOtherForm(c: Check, node: AstNode): boolean {
  if ((c.w.forms.get(node) ?? 0) > 0 || c.forms.includes(node)) return false
  if (node.type === 'emphasis' || node.type === 'strong' || node.type === 'comment') return true
  return node.key !== undefined && c.w.facts?.get(node)?.rawRef !== undefined
}

/** The last text node below `node`, or `node` itself where it is one. */
function lastText(node: AstNode | undefined): AstNode | null {
  let at = node
  while (at !== undefined && at.type !== 'text') at = at.children?.[at.children.length - 1]
  return at ?? null
}

/** The characters that read on into markup that stands directly behind them: `\\(`, `![`, `^[`, `$` and a backtick run. */
const JOINING = '\\!^$`'
/** The closing mark of each node that has one, for the escape of that mark in its content (C2-W-093). */
const CLOSING_MARKS = new Map([
  ['emphasis', '/'], ['strong', '*'], ['underline', '_'], ['strike', '~'], ['highlight', '='], ['superscript', '^'], ['subscript', ','],
  ['insert', '+'], ['delete', '-'], ['span', ']'], ['link', ']'], ['inline_footnote', ']'], ['inline_extension', ']'],
])

/**
 * Asks for a backslash in `text` where its end reads on into the markup behind it: before a last
 * character that joins that markup, or else before its last opening brace, which may open a brace
 * form that takes the markup (C2-I-043).
 */
function escapeEnd(c: Check, text: AstNode | null, braces: boolean): boolean {
  if (text === null) return false
  const value = text.value ?? ''
  if (value !== '' && JOINING.includes(value[value.length - 1]!) && escapeAt(c, text, value.length - 1)) return true
  return braces && escapeAt(c, text, value.lastIndexOf('{'))
}

/** Asks for a backslash before the first bare closing mark of `e` in its content, or before the first bracket in it. */
function escapeInContent(c: Check, e: AstNode): boolean {
  const mark = CLOSING_MARKS.get(e.type)
  if (mark === undefined || e.children === undefined) return false
  return escapeMark(c, e.children, 0, 0, mark) || (mark === ']' && escapeMark(c, e.children, 0, 0, '['))
}

/** Asks for the escape that keeps the text before `es[i]` from reading on into its opening markup. */
function escapeBefore(c: Check, es: readonly AstNode[], i: number): boolean {
  return escapeEnd(c, i > 0 ? lastText(es[i - 1]) : null, true)
}

/** Asks for the escape that keeps the end of the content of `es[i]` from reading on into its closing markup. */
function escapeInside(c: Check, es: readonly AstNode[], i: number): boolean {
  return escapeEnd(c, es[i]!.children === undefined ? null : lastText(es[i]), true)
}

/**
 * The node `es[i]` did not read back. The ways to make it form are tried one per round: an escape
 * before it, an escape at the end of its content, then its other spelling without those escapes,
 * then the escapes again, then an escape of its closing mark in its content. An escape that did
 * not help is taken back (C2-W-088).
 */
function respell(c: Check, es: readonly AstNode[], i: number): void {
  const e = es[i]!
  const attempt = c.w.attempts.get(e) ?? { step: 0, escapes: [] }
  c.w.attempts.set(e, attempt)
  const before = c.escapes.length
  while (attempt.step < RESPELL_STEPS.length) {
    const step = RESPELL_STEPS[attempt.step++]!
    if (!step(c, es, i, attempt)) continue
    for (const escape of c.escapes.slice(before)) attempt.escapes.push(escape)
    return
  }
  c.losses.push([e, null])
}

type RespellStep = (c: Check, es: readonly AstNode[], i: number, attempt: Attempt) => boolean

const RESPELL_STEPS: readonly RespellStep[] = [
  escapeBefore,
  escapeInside,
  (c, es, i, attempt) => {
    if (!hasOtherForm(c, es[i]!)) return false
    for (const escape of attempt.escapes) c.retracted.push(escape)
    attempt.escapes = []
    c.forms.push(es[i]!)
    return true
  },
  escapeBefore,
  escapeInside,
  (c, es, i) => escapeInContent(c, es[i]!),
]

/** How far behind the start of the construct `a` its opener takes the backslash (C2-W-090, C2-W-099). */
function openerShift(a: AstNode): number {
  const type = a.type
  if (type === 'image' || type === 'literal_inline' || type === 'inline_footnote') return 1
  if (type === 'math') return a.display === true ? 2 : 1
  if (type !== 'smart_punctuation') return 0
  const source = a.source ?? ''
  // The second hyphen, also of the braced en dash `{--}` (C2-I-043).
  return source.startsWith('{-') ? 2 : source.startsWith('-') ? 1 : 0
}

/** The text of `e` holds, at `at`, what the parse read as the construct `a`. */
function escapeOpener(c: Check, e: AstNode, at: number, a: AstNode): void {
  const value = e.value ?? ''
  let start = at
  // C2-I-023: a line comment takes the spaces before it.
  while (start < value.length && (value[start] === ' ' || value[start] === '\t')) start++
  if (!escapeAt(c, e, start + openerShift(a)) && !escapeAt(c, e, start)) c.losses.push([e, 'value'])
}

/** The cursor of a comparison of two inline lists: the next node of each, and the offset in a text of each. */
interface Cursor {
  i: number
  vi: number
  j: number
  aj: number
}

function isPaired(node: AstNode): boolean {
  return node.type === 'emphasis' || node.type === 'strong'
}

/** Asks for a backslash before the first bare `mark` in the text below `nodes`, from the offset `from` of the first node on. */
function escapeMark(c: Check, nodes: readonly AstNode[], start: number, from: number, mark: string): boolean {
  for (let at = start; at < nodes.length; at++) {
    const node = nodes[at]!
    if (node.type !== 'text') {
      if (node.children !== undefined && escapeMark(c, node.children, 0, 0, mark)) return true
      continue
    }
    const value = node.value ?? ''
    for (let k = value.indexOf(mark, at === start ? from : 0); k >= 0; k = value.indexOf(mark, k + 1)) if (escapeAt(c, node, k)) return true
  }
  return false
}

/**
 * The content of an emphasis or strong node ended in the parse at the offset `vi` of `es[i]`: a
 * delimiter in the content closed it. C2-W-069: the braced form holds such content; where the
 * node is braced already, the delimiter takes a backslash (C2-W-093).
 */
function closedEarly(c: Check, es: readonly AstNode[], i: number, vi: number, owner: AstNode): void {
  const mark = CLOSING_MARKS.get(owner.type)
  if (isPaired(owner) && hasOtherForm(c, owner)) c.forms.push(owner)
  else if (mark === undefined || !escapeMark(c, es, i, vi, mark)) c.losses.push([owner, null])
}

/**
 * The start of the line that ended the leaf, from the first line `from` that the parse does not
 * hold. C2-B-102: a block takes the attribute lines directly above it, so the line that opened
 * the block is the first one behind such lines.
 */
function openerLine(es: readonly AstNode[], from: number): number {
  let at = from
  while (at + 2 < es.length && es[at]!.type === 'text' && isBreak(es[at + 1]) && isBraceLine(es[at]!.value ?? '')) at += 2
  return at
}

function isBraceLine(value: string): boolean {
  return value.startsWith('{') && value.endsWith('}')
}

/** The content of `owner` ended in the parse before the expected node `es[i]`. */
function endedEarly(c: Check, es: readonly AstNode[], i: number, owner: AstNode): void {
  // C2-W-097: a backslash at the end of the text before took the markup of this node.
  if (i > 0 && escapeEnd(c, lastText(es[i - 1]), false)) return
  if (CLOSING_MARKS.has(owner.type)) closedEarly(c, es, i, 0, owner)
  else if (isBreak(es[i]) && i + 1 < es.length) escapeLineStart(c, es, openerLine(es, i + 1), owner)
  else c.losses.push([es[i] ?? owner, null])
}

/** Steps over the characters that the expected text `e` and the parsed text `a` share at the cursor. False where they differ. */
function matchCharacters(c: Check, e: AstNode, a: AstNode, at: Cursor): boolean {
  const value = e.value ?? ''
  const other = a.value ?? ''
  const length = Math.min(value.length - at.vi, other.length - at.aj)
  for (let k = 0; k < length; k++) {
    if (value.charCodeAt(at.vi + k) === other.charCodeAt(at.aj + k)) continue
    // The parse read a character of the text as markup, such as a backslash before punctuation (C2-W-097).
    if (!escapeAt(c, e, at.vi + k)) c.losses.push([e, 'value'])
    return false
  }
  at.vi += length
  at.aj += length
  if (at.aj === other.length) {
    at.j++
    at.aj = 0
  }
  return true
}

/**
 * Compares the expected text at the cursor with the parse. Returns false where the lists cannot
 * be compared further.
 */
function matchText(c: Check, es: readonly AstNode[], as: readonly AstNode[], at: Cursor, owner: AstNode): boolean {
  const e = es[at.i]!
  const value = e.value ?? ''
  const a = as[at.j]
  if (a === undefined) {
    if (CLOSING_MARKS.has(owner.type)) closedEarly(c, es, at.i, at.vi, owner)
    else c.losses.push([owner, null])
    return false
  }
  if (a.type !== 'text') return skipConstruct(c, e, a, at)
  if (!matchCharacters(c, e, a, at)) return false
  if (at.vi < value.length) return true
  at.i++
  at.vi = 0
  if (at.aj === 0 || es[at.i]?.type === 'text') return true
  // The parse has more text here: the node after the text did not form.
  if (es[at.i] === undefined) c.losses.push([owner, null])
  else if (at.j + 1 >= as.length && isPaired(owner)) closedEarly(c, es, at.i, 0, owner)
  else respell(c, es, at.i)
  return false
}

/** The parse read a construct where the tree has text: escapes its opener and steps over it (C2-W-091). */
function skipConstruct(c: Check, e: AstNode, a: AstNode, at: Cursor): boolean {
  escapeOpener(c, e, at.vi, a)
  if (a.pos === undefined) return false
  const end = spelledEnd(c.w, e, at.vi, a.pos.endOffset - a.pos.startOffset, c.cell)
  if (end < 0) return false
  at.vi = end
  at.j++
  if (at.vi === (e.value ?? '').length) {
    at.i++
    at.vi = 0
  }
  return true
}

/**
 * Whether the parse read `es[i]` differently because of the text beside it, which then takes a
 * backslash. C2-I-036: a brace block in the text behind a host was read as its attributes.
 * C2-I-105: the side a quote opens to, and the length of a dash, follow from the characters around.
 */
function readsNeighbor(c: Check, es: readonly AstNode[], i: number, a: AstNode): boolean {
  const e = es[i]!
  const next = textAt(es, i + 1)
  if (next !== null && !sameValue(e.attrs, a.attrs) && (next.value ?? '').startsWith('{')) return escapeAt(c, next, 0)
  if (e.type !== 'smart_punctuation' || (e.kind === a.kind && e.source === a.source)) return false
  if (next !== null && escapeAt(c, next, 0)) return true
  const before = textAt(es, i - 1)
  return before !== null && escapeAt(c, before, (before.value ?? '').length - 1)
}

function textAt(nodes: readonly AstNode[], at: number): AstNode | null {
  const node = nodes[at]
  return node?.type === 'text' ? node : null
}

/** Compares an expected node that is no text with the parse. Returns false where the lists cannot be compared further. */
function matchNode(c: Check, es: readonly AstNode[], as: readonly AstNode[], at: Cursor, owner: AstNode): boolean {
  const e = es[at.i]!
  const a = as[at.j]
  if (a === undefined) {
    endedEarly(c, es, at.i, owner)
    return false
  }
  if (a.type !== e.type || at.aj > 0) {
    respell(c, es, at.i)
    return false
  }
  if (readsNeighbor(c, es, at.i, a)) return false
  compareInline(c, e, a)
  at.i++
  at.j++
  return true
}

function compareInlines(c: Check, es: readonly AstNode[], as: readonly AstNode[], owner: AstNode): void {
  const at: Cursor = { i: 0, vi: 0, j: 0, aj: 0 }
  while (at.i < es.length) {
    const more = es[at.i]!.type === 'text' ? matchText(c, es, as, at, owner) : matchNode(c, es, as, at, owner)
    if (!more) return
  }
  if (at.j < as.length) c.losses.push([owner, null])
}

/** Compares a node that the writer took from the sidecar as it was typed: any difference sends it back to the tree form. */
function compareRaw(c: Check, e: AstNode, a: AstNode): void {
  const probe = createCheck(c.w)
  probe.cell = c.cell
  compareFields(probe, e, a)
  if (e.children !== undefined) compareInlines(probe, e.children, a.children ?? [], e)
  if (changes(probe) + probe.losses.length > 0) c.forms.push(e)
}

function compareFields(c: Check, e: AstNode, a: AstNode): void {
  const field = differingField(c, e, a)
  if (field !== null) c.losses.push([e, field])
}

function compareInline(c: Check, e: AstNode, a: AstNode): void {
  if (e.key !== undefined && hasOtherForm(c, e)) return compareRaw(c, e, a)
  compareFields(c, e, a)
  if (e.children !== undefined) compareInlines(c, e.children, a.children ?? [], e)
}

/** The block `e` read back as a block of another type. */
function blockMismatch(c: Check, e: AstNode): void {
  // C2-W-092: the first line of a paragraph read as a block opener.
  if (e.type === 'paragraph' && (e.children ?? []).length > 0) escapeLineStart(c, e.children!, 0, e)
  else c.losses.push([e, null])
}

/** The block `e` has no block in the parse: the block above it took its lines. */
function missingBlock(c: Check, e: AstNode): void {
  // C2-W-092: a paragraph that reads as a line of the block above. C2-W-059: a comment stands behind a blank line instead.
  if (e.type === 'paragraph' && (e.children ?? []).length > 0) escapeLineStart(c, e.children!, 0, e)
  else if (hasOtherForm(c, e)) c.forms.push(e)
  else c.losses.push([e, null])
}

function hasSpanMarks(table: AstNode): boolean {
  for (const group of table.children ?? []) {
    for (const row of group.children ?? []) for (const cell of row.children ?? []) if (cell.span !== undefined) return true
  }
  return false
}

function compareSlots(c: Check, e: AstNode, a: AstNode): void {
  if (Array.isArray(e.title)) compareInlines(c, e.title, Array.isArray(a.title) ? a.title : [], e)
  else if (Array.isArray(a.title)) c.losses.push([e, 'title'])
  if (e.caption !== undefined && a.caption !== undefined) compareBlock(c, e.caption, a.caption)
  else if (e.caption !== a.caption) c.losses.push([e.caption ?? e, e.caption === undefined ? 'caption' : null])
}

/** Compares one block with its parse. Returns false where the blocks behind it cannot be compared. */
function compareBlock(c: Check, e: AstNode, a: AstNode): boolean {
  if (e.type !== a.type) {
    blockMismatch(c, e)
    return false
  }
  const outer = [c.spanMarks, c.cell]
  if (e.type === 'table') c.spanMarks = hasSpanMarks(e) || hasSpanMarks(a)
  if (e.type === 'table_cell') c.cell = true
  compareFields(c, e, a)
  if (INLINE_PARENTS.includes(e.type)) compareInlines(c, e.children ?? [], a.children ?? [], e)
  else compareBlocks(c, e.children ?? [], a.children ?? [], e)
  compareSlots(c, e, a)
  c.spanMarks = outer[0]!
  c.cell = outer[1]!
  return true
}

/** Compares the blocks `es` of `owner`, as they were written, with their parse `as`. */
export function compareBlocks(c: Check, es: readonly AstNode[], as: readonly AstNode[], owner: AstNode): void {
  const before = changes(c)
  const count = Math.min(es.length, as.length)
  for (let at = 0; at < count; at++) if (!compareBlock(c, es[at]!, as[at]!)) return
  if (es.length === as.length || changes(c) > before) return
  // A line of a line block that reads as its closer ends the block (C2-B-123).
  if (owner.type === 'line_block' && as.length < es.length) escapeLineStart(c, es[as.length]!.children ?? [], 0, es[as.length]!)
  else if (es.length > as.length) missingBlock(c, es[as.length]!)
  else c.losses.push([owner, null])
}
