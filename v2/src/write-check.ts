// The escaping test of the writer (C2-W-088 to C2-W-091): the written blocks are parsed again
// and compared with the tree they were written from. Where the parse reads a construct that the
// tree does not hold, the opener of that construct takes a backslash; where a construct of the
// tree did not form, it takes its other spelling (C2-W-005). What neither repairs is a loss.
import {
  captionOf, childNodes, type CommentNode, type DocumentNode, type EmphasisNode, isBreak, isInlineParent, isRecord, type Node,
  type ParagraphNode, type StrongNode, type TableNode, type TableRowNode, type TextNode, titleOf,
} from './ast.ts'
import { buildSource } from './ast-blocks.ts'
import { utf8Length } from './positions.ts'
import { firstFrom, IN_CELL, IN_EMPHASIS, IN_STRONG, spelledEnd, writeInlines } from './write-inline.ts'
import { type Attempt, PLACE_COLUMNS, type Writer } from './write-state.ts'
import { isAsciiAlphanumeric, isAsciiPunctuation } from './unicode.ts'

/** The tree of `src`, one block of a larger document whose abbreviations are `abbreviations`. */
export function parseChunk(src: string, abbreviations: Map<string, string>): DocumentNode {
  return buildSource(src, true, abbreviations).document
}

/** One comparison of written blocks with their parse: what it asks the next write to change. */
export interface Check {
  w: Writer
  escapes: [TextNode, number][]
  /** Escapes of an earlier round that did not help and are taken back (C2-W-088). */
  retracted: [TextNode, number][]
  /** The escapes among `escapes` that a node which did not form asked for, which the test of C2-W-088 decides. */
  trials: [TextNode, number][]
  /** The escapes asked for and the escapes taken back, by text node, for the test whether an offset is escaped. */
  marks: Map<TextNode, Map<number, boolean>>
  forms: Node[]
  respelled: Set<Node>
  /** A block read back as another block, so the blocks behind it were not compared one by one. */
  misaligned: boolean
  /** What no change repairs. It is reported when a round asks for no change. */
  losses: [Node, string | null][]
  /** The flags the content under comparison was written with: in a table cell, inside emphasis, inside strong. */
  flags: number
  /** C2-A-093: the counts of a cell are a resolution result in a table that has span marks. */
  spanMarks: boolean
  /** The node whose inline content is under comparison. */
  owner: Node | null
}

export function createCheck(w: Writer): Check {
  return {
    w, escapes: [], retracted: [], trials: [], marks: new Map(), forms: [], respelled: new Set(), misaligned: false, losses: [], flags: 0,
    spanMarks: false, owner: null,
  }
}

/** The number of changes the comparison has asked for so far. */
function changes(c: Check): number {
  return c.escapes.length + c.forms.length + c.retracted.length
}

// C2-A-162: positions and the results of resolution are not compared.
const SKIPPED: readonly string[] = ['pos', 'segments', 'srcByteLength', 'stages', 'generatedId', 'resolvedAlign', 'n']
const NODE_SLOTS: readonly string[] = ['children', 'caption']
const NUMBERED: readonly string[] = ['footnote_ref', 'inline_footnote']

type Fields = Record<string, unknown>

function sameList(a: readonly unknown[], b: unknown): boolean {
  return Array.isArray(b) && a.length === b.length && a.every((item, at) => sameValue(item, b[at]))
}

function sameFields(left: Fields, right: Fields): boolean {
  for (const name in left) if (!SKIPPED.includes(name) && left[name] !== undefined && !sameValue(left[name], right[name])) return false
  for (const name in right) if (!SKIPPED.includes(name) && right[name] !== undefined && left[name] === undefined) return false
  return true
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return sameList(a, b)
  return isRecord(a) && isRecord(b) ? sameFields(a, b) : a === b
}

/** Whether equality compares the field `name` of `node` here, apart from its node slots (C2-A-161, C2-A-162). */
function isReference(node: Node): boolean {
  return (node.type === 'link' || node.type === 'image' || node.type === 'xref') && node.key !== undefined
}

function isCompared(c: Check, node: Node, name: string): boolean {
  if (SKIPPED.includes(name) || NODE_SLOTS.includes(name)) return false
  if (name === 'title') return titleOf(node) === undefined
  if ((name === 'href' || name === 'src') && isReference(node)) return false
  if (name === 'number' && NUMBERED.includes(node.type)) return false
  return !(c.spanMarks && node.type === 'table_cell' && (name === 'colspan' || name === 'rowspan'))
}

function sameField(name: string, a: unknown, b: unknown): boolean {
  if (name !== 'marker' || a === undefined || b === undefined) return sameValue(a, b)
  // C2-A-058: a start of 1 is the same as none.
  const normal = (marker: unknown): Fields => {
    const fields: Fields = isRecord(marker) ? { ...marker } : {}
    if (fields['start'] === 1) delete fields['start']
    return fields
  }
  return sameValue(normal(a), normal(b))
}

/** The name of the first field in which `e` and `a` differ, or null. */
function differingField(c: Check, e: Node, a: Node): string | null {
  // Every node is a record; the guard gives the fields of both by name.
  if (!isRecord(e) || !isRecord(a)) return null
  for (const name in e) {
    if (e[name] !== undefined && isCompared(c, e, name) && !sameField(name, e[name], a[name])) return name
  }
  for (const name in a) {
    if (a[name] !== undefined && e[name] === undefined && isCompared(c, a, name)) return name
  }
  return null
}

/** Asks for the other spelling of `node`. */
function changeForm(c: Check, node: Node): void {
  c.forms.push(node)
  c.respelled.add(node)
}

function mark(c: Check, node: TextNode, at: number, escaped: boolean): void {
  const marks = c.marks.get(node) ?? new Map<number, boolean>()
  marks.set(at, escaped)
  c.marks.set(node, marks)
}

function isEscaped(c: Check, node: TextNode, at: number): boolean {
  const asked = c.marks.get(node)?.get(at)
  if (asked !== undefined) return asked
  const written = c.w.escapes.get(node) ?? []
  return written[firstFrom(written, at)] === at
}

/** Asks for a backslash before the character `at` of the text node. False where that character takes none. */
function escapeAt(c: Check, node: TextNode, at: number): boolean {
  const value = node.value
  if (at < 0 || at >= value.length || !isAsciiPunctuation(value.charCodeAt(at)) || isEscaped(c, node, at)) return false
  c.escapes.push([node, at])
  mark(c, node, at, true)
  return true
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
  while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
  if (end > 0 && (value[end] === '.' || value[end] === ')')) offsets.push(end)
  return offsets
}

/** The line that starts at `nodes[from]` opened a block: escapes its opener (C2-W-090, C2-W-092). */
function escapeLineStart(c: Check, nodes: readonly Node[], from: number, owner: Node): void {
  c.misaligned = true
  const first = nodes[from]
  if (first?.type === 'text') for (const at of openerOffsets(first.value)) if (escapeAt(c, first, at)) return
  for (let at = from + 1; at < nodes.length && !isBreak(nodes[at]); at++) {
    const node = nodes[at]
    if (node?.type === 'text' && escapeAt(c, node, 0)) return
  }
  // The markup of the first node of the line reads as a block opener: its other spelling may not (C2-W-005).
  if (first !== undefined && hasOtherForm(c, first)) changeForm(c, first)
  else c.losses.push([first ?? owner, null])
}

function hasOtherForm(c: Check, node: Node): boolean {
  if ((c.w.forms.get(node) ?? 0) > 0 || c.respelled.has(node)) return false
  if (node.type === 'emphasis' || node.type === 'strong' || node.type === 'comment') return true
  return 'key' in node && node.key !== undefined && c.w.facts?.get(node)?.rawRef !== undefined
}

/** The last text node below `node`, or `node` itself where it is one. */
function lastText(node: Node | undefined): TextNode | null {
  let at = node
  for (;;) {
    if (at === undefined) return null
    if (at.type === 'text') return at
    const children = childNodes(at)
    at = children[children.length - 1]
  }
}

const CR = 13

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
function escapeEnd(c: Check, text: TextNode | null, braces: boolean): boolean {
  if (text === null) return false
  const value = text.value
  if (value !== '' && JOINING.includes(value[value.length - 1]!) && escapeAt(c, text, value.length - 1)) return true
  return braces && escapeAt(c, text, value.lastIndexOf('{'))
}

/** Asks for a backslash before the first bare closing mark of `e` in its content, or before the first bracket in it. */
function escapeInContent(c: Check, e: Node): boolean {
  const mark = CLOSING_MARKS.get(e.type)
  if (mark === undefined || !('children' in e)) return false
  return escapeMark(c, e.children, 0, 0, mark) || (mark === ']' && escapeMark(c, e.children, 0, 0, '['))
}

/** Whether the text before `es[i]` ends in a character that reads on into the markup of `es[i]` (C2-W-125). */
function joinsNext(es: readonly Node[], i: number): boolean {
  const value = i > 0 ? lastText(es[i - 1])?.value ?? '' : ''
  return value !== '' && JOINING.includes(value[value.length - 1]!)
}

/**
 * C2-W-125: a closer, or a lone bracket, of the node around `e` stands in the content of `e` and ended
 * that node early, as a `]` inside emphasis inside an inline footnote. Its first one takes the backslash.
 */
function escapeOwnerMark(c: Check, e: Node): boolean {
  const mark = c.owner === null ? undefined : CLOSING_MARKS.get(c.owner.type)
  if (mark === undefined || !('children' in e)) return false
  return escapeMark(c, e.children, 0, 0, mark) || (mark === ']' && escapeMark(c, e.children, 0, 0, '['))
}

/** Asks for the escape that keeps the text before `es[i]` from reading on into its opening markup. */
function escapeBefore(c: Check, es: readonly Node[], i: number): boolean {
  return escapeEnd(c, i > 0 ? lastText(es[i - 1]) : null, true)
}

/**
 * C2-W-099, C2-W-093: a content that starts with the mark of its own opener continues the run of
 * that mark, as `{-` and a hyphen read as a dash, so the first character of the content takes the backslash.
 */
function escapeContentStart(c: Check, e: Node): boolean {
  const mark = CLOSING_MARKS.get(e.type)
  const first = 'children' in e ? e.children[0] : undefined
  return mark !== undefined && mark !== ']' && first?.type === 'text' && first.value.startsWith(mark) && escapeAt(c, first, 0)
}

/**
 * Asks for the escape of the first character of the text behind `es[i]`, which can read on into its
 * markup: a name character behind a mention or a tag, a mark behind a closing mark, or the neighbor
 * that decides a smart punctuation mark (C2-I-104, C2-W-125).
 */
function escapeAfter(c: Check, es: readonly Node[], i: number): boolean {
  const next = textAt(es, i + 1)
  return next !== null && escapeAt(c, next, 0)
}

/** Asks for the escape that keeps the end of the content of `es[i]` from reading on into its closing markup. */
function escapeInside(c: Check, es: readonly Node[], i: number): boolean {
  const e = es[i]
  return escapeEnd(c, e !== undefined && 'children' in e ? lastText(e) : null, true)
}

/**
 * The node `es[i]` did not read back. The ways to make it form are tried one per round: an escape
 * before it, an escape at the end of its content, then its other spelling without those escapes,
 * then the escapes again, then an escape of its closing mark in its content. An escape that did
 * not help is taken back (C2-W-088).
 */
function respell(c: Check, es: readonly Node[], i: number): boolean {
  const e = es[i]!
  // A node that the writer reported as lost when it wrote it reads back as something else, and nothing repairs that.
  if (c.w.lost.has(e)) return false
  const attempt = c.w.attempts.get(e) ?? { step: 0, escapes: [] }
  c.w.attempts.set(e, attempt)
  const before = c.escapes.length
  while (attempt.step < RESPELL_STEPS.length) {
    const step = RESPELL_STEPS[attempt.step++]!
    if (!step(c, es, i, attempt)) continue
    for (let at = before; at < c.escapes.length; at++) {
      attempt.escapes.push(c.escapes[at]!)
      c.trials.push(c.escapes[at]!)
    }
    return true
  }
  c.losses.push([e, null])
  return false
}

type RespellStep = (c: Check, es: readonly Node[], i: number, attempt: Attempt) => boolean

// C2-W-088: the leftmost construct takes the backslash first, so a construct inside the content is
// escaped before the end of the content and the text behind the node.
const RESPELL_STEPS: readonly RespellStep[] = [
  escapeBefore,
  (c, es, i) => escapeContentStart(c, es[i]!),
  (c, es, i) => escapeContentConstruct(c, es[i]!),
  escapeInside,
  escapeAfter,
  (c, es, i) => escapeContentLine(c, es[i]!),
  (c, es, i) => escapeOwnerMark(c, es[i]!),
  (c, es, i, attempt) => {
    if (!hasOtherForm(c, es[i]!)) return false
    for (const escape of attempt.escapes) {
      c.retracted.push(escape)
      mark(c, escape[0], escape[1], false)
    }
    attempt.escapes = []
    changeForm(c, es[i]!)
    return true
  },
  escapeBefore,
  escapeInside,
  (c, es, i) => escapeInContent(c, es[i]!),
]

/**
 * C2-W-088: the content of `e`, written and parsed on its own, holds a construct that the tree
 * does not, such as a code span that runs on over the closing mark of `e`. The opener of the
 * leftmost one takes the backslash. A content that does not read as one paragraph tells nothing.
 */
function escapeContentConstruct(c: Check, e: Node): boolean {
  if (!('children' in e) || e.children.length === 0) return false
  // The probe has its own attempts and losses, so what it finds in the content stays out of this round.
  const probe = createCheck({ ...c.w, attempts: new Map(), losses: { entries: [], nodes: [] }, lost: new Set(c.w.lost) })
  probe.flags = c.flags | (e.type === 'emphasis' ? IN_EMPHASIS : e.type === 'strong' ? IN_STRONG : 0)
  // A content that opens a block on its own line is read again behind a word, which opens none, and
  // then with its line breaks as spaces, so that no later line opens one either.
  const word: Node = { type: 'text', value: 'x' }
  const flat = e.children.map((node): Node => (node.type === 'soft_break' ? { type: 'text', value: ' ' } : node))
  for (const expected of [e.children, [word, ...e.children], [word, ...flat]]) {
    const parsed = parseChunk(`${writeInlines(probe.w, expected, probe.flags)}\n`, c.w.abbreviations).children
    const block = parsed[0]
    if (parsed.length !== 1 || block?.type !== 'paragraph') continue
    compareInlines(probe, expected, block.children, e)
    for (const [node, at] of probe.escapes) if (escapeAt(c, node, at)) return true
    return false
  }
  return false
}

/**
 * C2-W-026, C2-W-092: a line inside the content of `e` that has the shape of a block opener may
 * have opened a block and so ended `e`. The first such line takes the escape of its opener; the
 * test of C2-W-088 then decides whether it was asked for.
 */
function escapeContentLine(c: Check, e: Node): boolean {
  if (!('children' in e)) return false
  const nodes = e.children
  for (let at = 0; at < nodes.length; at++) {
    const node = nodes[at]!
    if ('children' in node && escapeContentLine(c, node)) return true
    const next = nodes[at + 1]
    if (!isBreak(node) || next?.type !== 'text' || !hasOpenerShape(next)) continue
    for (const offset of openerOffsets(next.value)) if (escapeAt(c, next, offset)) return true
  }
  return false
}

/** How far behind the start of the construct `a` its opener takes the backslash (C2-W-090, C2-W-099). */
function openerShift(a: Node): number {
  if (a.type === 'image' || a.type === 'literal_inline' || a.type === 'inline_footnote') return 1
  if (a.type === 'math') return a.display ? 2 : 1
  if (a.type !== 'smart_punctuation') return 0
  const source = a.source
  // The second hyphen, also of the braced en dash `{--}` (C2-I-043).
  return source.startsWith('{-') ? 2 : source.startsWith('-') ? 1 : 0
}

/** The text of `e` holds, at `at`, what the parse read as the construct `a`. */
function escapeOpener(c: Check, e: TextNode, at: number, a: Node): void {
  const value = e.value
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
  /** The last node of the expected list that started where a node of the parse starts, and the byte offset of that start, or -1. */
  anchor: number
  anchorByte: number
}

function isPaired(node: Node): node is EmphasisNode | StrongNode {
  return node.type === 'emphasis' || node.type === 'strong'
}

/** Asks for a backslash before the first bare `mark` in the text below `nodes`, from the offset `from` of the first node on. */
function escapeMark(c: Check, nodes: readonly Node[], start: number, from: number, mark: string): boolean {
  for (let at = start; at < nodes.length; at++) {
    const node = nodes[at]!
    if (node.type !== 'text') {
      if ('children' in node && escapeMark(c, node.children, 0, 0, mark)) return true
      continue
    }
    const value = node.value
    for (let k = value.indexOf(mark, at === start ? from : 0); k >= 0; k = value.indexOf(mark, k + 1)) if (escapeAt(c, node, k)) return true
  }
  return false
}

/**
 * The content of an emphasis or strong node ended in the parse at the offset `vi` of `es[i]`: a
 * delimiter in the content closed it. C2-W-069: the braced form holds such content; where the
 * node is braced already, the delimiter takes a backslash (C2-W-093).
 */
function closedEarly(c: Check, es: readonly Node[], i: number, vi: number, owner: Node): void {
  const mark = CLOSING_MARKS.get(owner.type)
  if (isPaired(owner) && hasOtherForm(c, owner)) changeForm(c, owner)
  else if (mark === undefined || !escapeMark(c, es, i, vi, mark)) c.losses.push([owner, null])
}

/**
 * The start of the line that ended the leaf, from the first line `from` that the parse does not
 * hold. C2-B-102: a block takes the attribute lines directly above it, so the line that opened
 * the block is the first one behind such lines.
 */
function openerLine(es: readonly Node[], from: number): number {
  let at = from
  while (at + 2 < es.length && isBraceLine(es[at]) && isBreak(es[at + 1])) at += 2
  return at
}

function isBraceLine(node: Node | undefined): boolean {
  return node?.type === 'text' && node.value.startsWith('{') && node.value.endsWith('}')
}

/** The content of `owner` ended in the parse before the expected node `es[i]`. */
function endedEarly(c: Check, es: readonly Node[], i: number, owner: Node): void {
  // C2-W-097: a backslash at the end of the text before took the markup of this node. A line break has no markup to take.
  if (i > 0 && !isBreak(es[i]) && escapeEnd(c, lastText(es[i - 1]), false)) return
  // C2-W-026, C2-W-092: the content ended at the start of a line, which opened a block.
  if (i > 0 && isBreak(es[i - 1])) escapeLineStart(c, es, openerLine(es, i), owner)
  else if (CLOSING_MARKS.has(owner.type)) closedEarly(c, es, i, 0, owner)
  else if (isBreak(es[i]) && i + 1 < es.length) escapeLineStart(c, es, openerLine(es, i + 1), owner)
  else c.losses.push([es[i] ?? owner, null])
}

/** Steps over the characters that the expected text `e` and the parsed text `a` share at the cursor. False where they differ. */
function matchCharacters(c: Check, e: TextNode, a: TextNode, at: Cursor): boolean {
  const value = e.value
  const other = a.value
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
/** The parse ended inside the text node `es[at.i]` of `owner`. */
function parseEndsInText(c: Check, es: readonly Node[], at: Cursor, owner: Node): boolean {
  // C2-W-016: a CR that ends a line is read as part of the line ending, and no spelling keeps it.
  if (es[at.i]?.type === 'text' && (es[at.i] as TextNode).value.charCodeAt(at.vi) === CR) {
    c.losses.push([es[at.i]!, 'value'])
    return false
  }
  // C2-W-093: the node before took this text into its content, its mark closing the node in place of the node's own.
  if (at.vi === 0 && at.i > 0 && startsWithCloser(es[at.i - 1]!, es[at.i]) && escapeAt(c, es[at.i] as TextNode, 0)) return false
  // C2-W-026, C2-W-092: the content ended at the start of a line, which opened a block.
  if (at.vi === 0 && at.i > 0 && isBreak(es[at.i - 1])) escapeLineStart(c, es, openerLine(es, at.i), owner)
  else if (CLOSING_MARKS.has(owner.type)) closedEarly(c, es, at.i, at.vi, owner)
  else c.losses.push([owner, null])
  return false
}

/** Whether `next` is text that starts with the closing mark of `node`. */
function startsWithCloser(node: Node, next: Node | undefined): boolean {
  const mark = CLOSING_MARKS.get(node.type)
  return mark !== undefined && next?.type === 'text' && next.value.startsWith(mark)
}

/** The text node `es[at.i]` is matched to its end; the parse may hold more text behind it. */
function afterTextNode(c: Check, es: readonly Node[], as: readonly Node[], at: Cursor, owner: Node): boolean {
  at.i++
  at.vi = 0
  if (at.aj === 0 || es[at.i]?.type === 'text') return true
  // The parse has more text here: the node after the text did not form. At the end of the content
  // the closing mark did not close, as a mark of the content glued to it makes a longer run (C2-W-093).
  if (es[at.i] === undefined) {
    if (!escapeInContent(c, owner)) c.losses.push([owner, null])
  }
  else if (at.j + 1 >= as.length && isPaired(owner) && !joinsNext(es, at.i)) closedEarly(c, es, at.i, 0, owner)
  else return respell(c, es, at.i) && stepOver(c, es, as, at)
  return false
}

function matchText(c: Check, e: TextNode, es: readonly Node[], as: readonly Node[], at: Cursor, owner: Node): boolean {
  const value = e.value
  const a = as[at.j]
  if (a === undefined) return parseEndsInText(c, es, at, owner)
  if (a.type !== 'text') return skipConstruct(c, e, a, at)
  if (!matchCharacters(c, e, a, at)) return false
  return at.vi < value.length || afterTextNode(c, es, as, at, owner)
}

/**
 * The node `es[at.i]` did not form, so its markup stands in the text of the parse. Steps over it
 * there, so that one round also finds what behind it did not read back (C2-W-091). False where
 * the text of the parse does not hold the node as it was written.
 */
function stepOver(c: Check, es: readonly Node[], as: readonly Node[], at: Cursor): boolean {
  const a = as[at.j]
  const spelled = writeInlines(c.w, [es[at.i]!], c.flags)
  // An escape in the node is one character of the text, so the two do not compare by length.
  if (a?.type !== 'text' || spelled.includes('\\') || !a.value.startsWith(spelled, at.aj)) return false
  at.aj += spelled.length
  if (at.aj === a.value.length) {
    at.j++
    at.aj = 0
  }
  at.i++
  return true
}

/** The parse read a construct where the tree has text: escapes its opener and steps over it (C2-W-091). */
function skipConstruct(c: Check, e: TextNode, a: Node, at: Cursor): boolean {
  escapeOpener(c, e, at.vi, a)
  const pos = a.pos
  if (pos === undefined) return false
  const end = spelledEnd(c.w, e, at.vi, pos.endOffset - pos.startOffset, (c.flags & IN_CELL) !== 0)
  if (end < 0) return false
  at.vi = end
  at.j++
  if (at.vi === e.value.length) {
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
function readsNeighbor(c: Check, e: Node, es: readonly Node[], i: number, a: Node): boolean {
  const next = textAt(es, i + 1)
  if (next !== null && !sameValue(e.attrs, a.attrs) && next.value.startsWith('{')) return escapeAt(c, next, 0)
  // C2-I-015: a backtick behind a closing run makes it longer, so the span reads on into the text behind it.
  // C2-I-090: a name character behind a mention or a tag makes the name longer.
  if (next !== null && readsOn(e, next) && differingField(c, e, a) !== null) return escapeAt(c, next, 0)
  if (e.type !== 'smart_punctuation' || a.type !== 'smart_punctuation' || (e.kind === a.kind && e.source === a.source)) return false
  if (next !== null && escapeAt(c, next, 0)) return true
  const before = textAt(es, i - 1)
  return before !== null && escapeAt(c, before, before.value.length - 1)
}

/** Whether the text `next` can read on into the end of the spelling of `node`: a closing backtick run, or a name. */
function readsOn(node: Node, next: TextNode): boolean {
  if (node.attrs !== undefined) return false
  if (node.type === 'mention' || node.type === 'tag') return true
  return (node.type === 'code' || node.type === 'literal_inline' || node.type === 'math') && next.value.startsWith('`')
}

function textAt(nodes: readonly Node[], at: number): TextNode | null {
  const node = nodes[at]
  return node?.type === 'text' ? node : null
}

function isLostCode(c: Check, node: Node | undefined): boolean {
  return node !== undefined && node.type === 'code' && c.w.lost.has(node)
}

/** Compares an expected node that is no text with the parse. Returns false where the lists cannot be compared further. */
function matchNode(c: Check, e: Node, es: readonly Node[], as: readonly Node[], at: Cursor, owner: Node): boolean {
  const a = as[at.j]
  if (a === undefined) {
    endedEarly(c, es, at.i, owner)
    return false
  }
  if (a.type !== e.type || at.aj > 0) return respell(c, es, at.i) && stepOver(c, es, as, at)
  if (isLostCode(c, es[at.i + 1])) {
    // C2-W-112: the code spans behind this one were written into it and reported.
    at.i++
    while (isLostCode(c, es[at.i])) at.i++
    at.j++
    return true
  }
  if (readsNeighbor(c, e, es, at.i, a)) return false
  compareInline(c, e, a)
  at.i++
  at.j++
  return true
}

/** Notes the place of the cursor where both lists start a node there. A line break ends the line the offsets hold on. */
function setAnchor(es: readonly Node[], as: readonly Node[], at: Cursor): void {
  if (at.vi !== 0 || at.aj !== 0) return
  const pos = as[at.j]?.pos
  if (isBreak(es[at.i])) at.anchor = -1
  else if (pos !== undefined) {
    at.anchor = at.i
    at.anchorByte = pos.startOffset
  }
}

/**
 * After the two lists could not be compared further: moves the cursor to the next node of the
 * expected list at whose start, on the same line, a node of the parse starts too. Both lists
 * are parses of one source, so they can be compared again from there, and one round finds the
 * other deviations of the line (C2-W-091). False where there is no such place.
 */
/** The first parsed node from `j` on that starts at `offset` or later. */
function firstNodeFrom(as: readonly Node[], j: number, offset: number): number {
  while (j < as.length && (as[j]!.pos?.startOffset ?? -1) < offset) j++
  return j
}

function resumeAt(at: Cursor, i: number, j: number): boolean {
  at.i = i
  at.j = j
  at.vi = 0
  at.aj = 0
  return true
}

function resync(c: Check, es: readonly Node[], as: readonly Node[], at: Cursor): boolean {
  const failed = as[at.j]?.pos
  if (at.anchor < 0 || failed === undefined) return false
  let offset = at.anchorByte
  let j = at.j
  for (let k = at.anchor; k < es.length && !isBreak(es[k]); k++) {
    j = firstNodeFrom(as, j, offset)
    if (k > at.i && offset >= failed.endOffset && as[j]?.pos?.startOffset === offset) return resumeAt(at, k, j)
    offset += utf8Length(writeInlines(c.w, [es[k]!], c.flags))
  }
  return false
}

function compareInlines(c: Check, es: readonly Node[], as: readonly Node[], owner: Node): void {
  const outer = c.owner
  c.owner = owner
  compareList(c, es, as, owner)
  c.owner = outer
}

function compareList(c: Check, es: readonly Node[], as: readonly Node[], owner: Node): void {
  const at: Cursor = { i: 0, vi: 0, j: 0, aj: 0, anchor: -1, anchorByte: 0 }
  while (at.i < es.length) {
    setAnchor(es, as, at)
    const e = es[at.i]!
    const more = e.type === 'text' ? matchText(c, e, es, as, at, owner) : matchNode(c, e, es, as, at, owner)
    if (!more && !resync(c, es, as, at)) return
  }
  if (at.j < as.length) c.losses.push([owner, null])
}

/** Compares a node that the writer took from the sidecar as it was typed: any difference sends it back to the tree form. */
function compareRaw(c: Check, e: Node, a: Node): void {
  const probe = createCheck(c.w)
  probe.flags = c.flags
  compareFields(probe, e, a)
  if ('children' in e) compareInlines(probe, e.children, childNodes(a), e)
  // A difference behind another change of this round may come from that change, so the next round decides.
  if (changes(probe) + probe.losses.length > 0 && changes(c) === 0) changeForm(c, e)
  else if (changes(probe) + probe.losses.length > 0) c.misaligned = true
}

function compareFields(c: Check, e: Node, a: Node): void {
  const field = differingField(c, e, a)
  if (field !== null) c.losses.push([e, field])
}

function compareInline(c: Check, e: Node, a: Node): void {
  if ('key' in e && e.key !== undefined && hasOtherForm(c, e)) return compareRaw(c, e, a)
  compareFields(c, e, a)
  if (!('children' in e)) return
  const outer = c.flags
  if (e.type === 'emphasis') c.flags |= IN_EMPHASIS
  else if (e.type === 'strong') c.flags |= IN_STRONG
  compareInlines(c, e.children, childNodes(a), e)
  c.flags = outer
}

/** The block `e` read back as a block of another type. */
function blockMismatch(c: Check, e: Node): void {
  c.misaligned = true
  // C2-W-092: the first line of a paragraph read as a block opener.
  if (e.type === 'paragraph' && e.children.length > 0) escapeLineStart(c, e.children, 0, e)
  else c.losses.push([e, null])
}

/** The block `e` has no block in the parse: the block above it took its lines. */
function missingBlock(c: Check, e: Node): void {
  // C2-W-092: a paragraph that reads as a line of the block above. C2-W-059: a comment stands behind a blank line instead.
  if (e.type === 'paragraph' && e.children.length > 0) escapeLineStart(c, e.children, 0, e)
  else if (hasOtherForm(c, e)) changeForm(c, e)
  else c.losses.push([e, null])
}

function hasSpanMarks(table: TableNode): boolean {
  for (const group of table.children) {
    if (group.type !== 'comment' && group.children.some(rowHasSpanMarks)) return true
  }
  return false
}

function rowHasSpanMarks(row: TableRowNode | CommentNode): boolean {
  return row.type === 'table_row' && row.children.some((cell) => cell.span !== undefined)
}

function compareSlots(c: Check, e: Node, a: Node): void {
  const title = titleOf(e)
  const parsedTitle = titleOf(a)
  if (title !== undefined) compareInlines(c, title, parsedTitle ?? [], e)
  else if (parsedTitle !== undefined) c.losses.push([e, 'title'])
  const caption = captionOf(e)
  const parsedCaption = captionOf(a)
  if (caption !== undefined && parsedCaption !== undefined) compareBlock(c, caption, parsedCaption)
  else if (caption !== parsedCaption) c.losses.push([caption ?? e, caption === undefined ? 'caption' : null])
}

/** Compares one block with its parse. Returns false where the blocks behind it cannot be compared. */
function compareBlock(c: Check, e: Node, a: Node): boolean {
  if (c.w.lost.has(e)) return true
  if (e.type !== a.type) {
    blockMismatch(c, e)
    return false
  }
  const marks = c.spanMarks
  const flags = c.flags
  if (e.type === 'table' && a.type === 'table') c.spanMarks = hasSpanMarks(e) || hasSpanMarks(a)
  if (e.type === 'table_cell') c.flags |= IN_CELL
  compareFields(c, e, a)
  if (isInlineParent(e)) compareInlines(c, e.children, childNodes(a), e)
  else compareBlocks(c, childNodes(e), childNodes(a), e)
  compareSlots(c, e, a)
  c.spanMarks = marks
  c.flags = flags
  return true
}

/** The places at which the parse `node` has a paragraph, and the lines at which it has a block, from the blocks below it. */
function readStarts(node: Node, offset: number, paragraphs: Set<number>, lines: Set<number>): void {
  for (const block of childNodes(node)) {
    const pos = block.pos
    if (pos !== undefined) {
      lines.add(pos.startLine - offset)
      if (block.type === 'paragraph') paragraphs.add((pos.startLine - offset) * PLACE_COLUMNS + pos.startColumn - 1)
    }
    if (!isInlineParent(block)) readStarts(block, offset, paragraphs, lines)
    const caption = captionOf(block)
    if (caption !== undefined) readStarts(caption, offset, paragraphs, lines)
  }
}

/** Whether the text at the start of a line has the shape of a block opener: punctuation, or a marker of digits or letters. */
function hasOpenerShape(node: Node | undefined): boolean {
  const value = node?.type === 'text' ? node.value : ''
  if (value === '') return node !== undefined && node.type !== 'text'
  return !isAsciiAlphanumeric(value.charCodeAt(0)) || openerOffsets(value).length > 1
}

/** Whether the escapes of this round already touch `node`. */
function isPending(c: Check, node: Node | undefined): boolean {
  return node?.type === 'text' && c.marks.has(node)
}

/**
 * Escapes the opener of each line of the paragraph `e`, written at `place`, at which the parse has a
 * block. A line can start inside an inline node, such as emphasis or an inline footnote over two lines.
 */
function escapeOpenerLines(c: Check, e: ParagraphNode, place: number, paragraphs: Set<number>, lines: Set<number>): void {
  const top = e.children
  if (!paragraphs.has(place) && hasOpenerShape(top[0]) && !isPending(c, top[0])) escapeLineStart(c, top, 0, e)
  let line = Math.floor(place / PLACE_COLUMNS)
  const visit = (nodes: readonly Node[]): void => {
    for (let at = 0; at < nodes.length; at++) {
      const node = nodes[at]!
      if ('children' in node) visit(node.children)
      if (!isBreak(node)) continue
      line++
      if (lines.has(line) && hasOpenerShape(nodes[at + 1]) && !isPending(c, nodes[at + 1])) escapeLineStart(c, nodes, at + 1, e)
    }
  }
  visit(top)
}

/**
 * After a block read back as another block, the blocks behind it are not compared one by one.
 * This finds the other lines of the group that opened a block, by the lines at which the parse
 * `parsed` has one, so that one round escapes all of them (C2-W-092). `offset` is the line of
 * the parse at which the group starts.
 */
export function escapeOpeners(c: Check, parsed: DocumentNode, offset: number): void {
  if (!c.misaligned) return
  const paragraphs = new Set<number>()
  const lines = new Set<number>()
  readStarts(parsed, offset, paragraphs, lines)
  for (const [node, place] of c.w.starts) {
    if (node.attrs === undefined && node.lang === undefined) escapeOpenerLines(c, node, place, paragraphs, lines)
  }
}

/** Compares the blocks `es` of `owner`, as they were written, with their parse `as`. */
export function compareBlocks(c: Check, es: readonly Node[], as: readonly Node[], owner: Node): void {
  const before = changes(c)
  const count = Math.min(es.length, as.length)
  for (let at = 0; at < count; at++) if (!compareBlock(c, es[at]!, as[at]!)) return
  // What a lost block was written as has its own count of blocks.
  if (es.length === as.length || changes(c) > before || es.some((e) => c.w.lost.has(e))) return
  // A line of a line block that reads as its closer ends the block (C2-B-123).
  const missing = es[as.length]
  // The blocks below differ in number, so a line of one of them may have opened a block (C2-W-092).
  c.misaligned = true
  if (owner.type === 'line_block' && missing !== undefined) escapeLineStart(c, childNodes(missing), 0, missing)
  else if (es.length > as.length) missingBlock(c, es[as.length]!)
  else c.losses.push([owner, null])
}
