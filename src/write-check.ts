// The escaping test of the writer (C2-W-088 to C2-W-091): the written blocks are parsed again
// and compared with the tree they were written from. Where the parse reads a construct that the
// tree does not hold, the opener of that construct takes a backslash; where a construct of the
// tree did not form, it takes its other spelling (C2-W-005). What neither repairs is a loss.
import { pushAll } from './arrays.ts'
import {
  captionOf, childNodes, type CommentNode, type DocumentNode, type EmphasisNode, isBreak, isInlineParent, isRecord,
  type LinkNode, type Node, type ParagraphNode, type StrongNode, type TableNode, type TableRowNode, type TextNode, titleOf,
} from './ast.ts'
import { buildSource } from './ast-blocks.ts'
import { applyExtensions } from './extensions/claims.ts'
import { AST_RESULTS } from './ast-tables.ts'
import { sourceCoreEquivalent } from './write-extension-source.ts'
import { treesEqual } from './ast-json.ts'
import { isSecondHalf, stringOffsetOfByte, unitBytes, utf8Length } from './positions.ts'
import {
  escapeOffsets, firstFrom, IN_BRACKET, IN_CELL, IN_EMPHASIS, IN_NOTE, IN_STRONG, joinsNextCode, keyIsContent, leadingCaret,
  spelledEnd,
  writeInline, writeInlines,
} from './write-inline.ts'
import { type Attempt, type ParseCache, PLACE_COLUMNS, recordedRaw, type Writer } from './write-state.ts'
import { braceBlock, isKey, spelledValue } from './write-attributes.ts'
import { isAsciiAlphanumeric, isAsciiPunctuation, isBoundarySpace, isWordCharacter } from './unicode.ts'
import { BACKSLASH, BRACKET_CLOSE, BRACKET_OPEN, CARET } from './chars.ts'
import { escapeKinds, escapePartnerClosers } from './write-kinds.ts'
import { BRACED_MARKS, CLASS_KEY_REST } from './inline-tables.ts'
import { classRunEnd, emptyMemo, readAttributeBlock } from './attributes.ts'
import { textQuoteKind } from './write-plan-smart.ts'

/** The tree of `src`, one block of the document that `w` writes. Each call is counted in `w.parses`. */
export function parseChunk(w: Writer, src: string, linkKeys: ReadonlySet<string> | null = w.linkKeys,
  positions = true): DocumentNode {
  const plain = positions && plainParse(w, linkKeys)
  const cacheable = plain && src.length <= 8192
  const cache = w.parseCache
  const cached = cacheable ? cache.trees.get(src) : undefined
  if (cached !== undefined && cached !== null) return cached
  if (cached === undefined) {
    w.parses++
    w.work.chars += src.length
  }
  // A longer source that one of the last rounds wrote again is counted as a parse, but its tree is reused.
  const recent = plain && !cacheable ? cache.recent.find((entry) => entry[0] === src)?.[1] : undefined
  if (recent !== undefined) return recent
  const extensions = w.extensions
  const source = buildSource(src, positions, w.abbreviations, null, extensions.length > 0, linkKeys)
  const parsed = applyExtensions(source, extensions, linkKeys).document
  if (cacheable) remember(cache, src, parsed, cached === null)
  else if (plain) rememberRecent(cache, src, parsed)
  return parsed
}

const RECENT_TREES = 2

/** Whether a parse of the writer reads nothing but its source, so a tree of the same source can stand in for it. */
function plainParse(w: Writer, linkKeys: ReadonlySet<string> | null): boolean {
  return w.extensions.length === 0 && w.abbreviations.size === 0 && (linkKeys === null || linkKeys.size === 0)
}

function rememberRecent(cache: ParseCache, src: string, parsed: DocumentNode): void {
  cache.recent.unshift([src, parsed])
  cache.recent.length = Math.min(cache.recent.length, RECENT_TREES)
}

// The characters of the sources whose trees the parse cache keeps on first sight; the blocks it reuses are short.
const MAX_TREE_CHARS = 16_384

/**
 * A repeated source keeps its tree from its second parse on, so each source is parsed uncounted at most once, which is
 * no longer than its counted first parse: the repair limit (C2-W-133) still bounds the work.
 */
function remember(cache: ParseCache, src: string, parsed: DocumentNode, repeated: boolean): void {
  if (!repeated && cache.trees.size >= 128) {
    cache.trees.clear()
    cache.treeChars = 0
  }
  const kept = repeated || cache.treeChars + src.length <= MAX_TREE_CHARS
  if (kept) cache.treeChars += src.length
  cache.trees.set(src, kept ? parsed : null)
}

/** The tree of the whole written document, for the check of C2-W-144; it is no repair parse of a group. */
export function parseWritten(w: Writer, src: string): DocumentNode {
  const extensions = w.extensions
  return applyExtensions(buildSource(src, true, w.abbreviations, null, extensions.length > 0, w.linkKeys), extensions, w.linkKeys).document
}

/** C2-W-133: whether the repair of the group has parsed more than its limit. */
export function exhausted(w: Writer): boolean {
  return w.work.chars > w.work.limit
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
  /** The escapes among `escapes` that open a run of escapes in one round (`extendChains`), with the construct each one stops. */
  chains: [TextNode, number, Node][]
  /** The written group the parse under comparison was made of, or null in a probe of part of it. */
  source: string | null
  /** The UTF-8 bytes of `source`, read when an offset of the parse is checked against it. */
  bytes: Uint8Array | null
  /** C2-W-088: the escapes among `escapes` that make a line opener text, by text node. */
  lineEscapes: Map<TextNode, Set<number>>
  /** C2-W-088: block openers inside a line, which take their own escape and no kind. */
  ownEscapes: Map<TextNode, Set<number>>
  /** A delimiter inside the content under comparison took a backslash because it closed the content early. */
  cut: boolean
  /**
   * The trials among `trials` that escape the first character of the content of a node (`escapeContentStart`), also
   * where a probe of an outer content asked for them: the round tests each one in its context (`dropIdleLeads`).
   */
  leadTrials: Set<[TextNode, number]>
  /** The trials among `trials` that escape a backtick a probe found opening a code span. */
  codeTrials: Set<[TextNode, number]>
  /** Escapes of a closer that ended a node early (C2-W-125, case five); in a probe round they give no kind (C2-W-088). */
  closers: Set<[TextNode, number]>
  /**
   * C2-W-125, case one: a brace in the content of a tree node that the parse read on past its closer. A span on the
   * tree node's own opener is that node (C2-W-088), so the backslash gives no kind.
   */
  readOn: Set<[TextNode, number]>
  /** The closers among `closers` that ended a braced emphasis or strong early, each with that node (C2-W-093). */
  earlyClosers: [Node, [TextNode, number]][]
  /** The inline nodes around the content under comparison, innermost last, each as its list and its place there. */
  around: [readonly Node[], number, number][]
  /** Escapes of a construct a probe found running over the closers around its node: reported, so no trial (C2-W-088). */
  reported: Set<[TextNode, number]>
  /** The escapes of the openers of constructs the parse holds and the tree does not (C2-W-088). */
  constructs: Set<[TextNode, number]>
  /** Escapes of a closing mark at the start of the text behind a node that took that text into its content (C2-W-093). */
  behind: Set<[TextNode, number]>
  /** C2-W-125, case six: escapes of a text character directly behind a node that would lengthen it; they give no kind (C2-W-088). */
  lengthening: Set<[TextNode, number]>
  /** Lengthening escapes behind paired spans can be C2-W-125 trials beside reported constructs. */
  pairedLengthening: Set<[TextNode, number]>
  /** C2-I-118: the capped openers this round escaped, each with its text and the end of its construct there. */
  capped: [TextNode, number, number][]
  /** C2-W-125, case eight: a text `^[` kept bare while its early closer took the backslash in this round. */
  earlyCloser: boolean
  /** C2-W-125, case eight: the text `^[` whose early closer this round already escaped, by text node. */
  notesDone: Map<TextNode, Set<number>>
  /**
   * In a probe of the content of an inline footnote whose parse in its context holds no caret pair, that note: a caret
   * pair the probe reads opens nothing there (C2-I-089).
   */
  note: Node | null
  /** The parsed list and the place in it of the node under respelling, for the test of `note`. */
  parsed: readonly Node[]
  parsedAt: number
  /** In a probe: a node around the probed content, outside `around`, can form (`noneForms`). */
  formsAround: boolean
}

export function createCheck(w: Writer): Check {
  return {
    w, escapes: [], retracted: [], trials: [], marks: new Map(), forms: [], respelled: new Set(), misaligned: false, losses: [], flags: 0,
    spanMarks: false, owner: null, chains: [], source: null, bytes: null, lineEscapes: new Map(), ownEscapes: new Map(),
    cut: false, codeTrials: new Set(), leadTrials: new Set(), closers: new Set(), readOn: new Set(), earlyClosers: [], around: [],
    reported: new Set(),
    constructs: new Set(), behind: new Set(), lengthening: new Set(), pairedLengthening: new Set(), capped: [],
    earlyCloser: false, notesDone: new Map(), note: null,
    parsed: [], parsedAt: 0, formsAround: false,
  }
}

/** The number of changes the comparison has asked for so far. */
function changes(c: Check): number {
  return c.escapes.length + c.forms.length + c.retracted.length
}

// C2-A-162: positions and the results of resolution are not compared.
const NODE_SLOTS: readonly string[] = ['children', 'caption']
const IGNORED_DATA = new Set(['carve.source', 'carve.style', 'carve.annotation'])

type Fields = Record<string, unknown>

function sameList(a: readonly unknown[], b: unknown): boolean {
  return Array.isArray(b) && a.length === b.length && a.every((item, at) => sameValue(item, b[at]))
}

function sameFields(left: Fields, right: Fields): boolean {
  for (const name in left) if (!skipped(left, name, false) && left[name] !== undefined && !sameValue(left[name], right[name])) return false
  for (const name in right) if (!skipped(right, name, false) && right[name] !== undefined && left[name] === undefined) return false
  return true
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) return sameList(a, b)
  return isRecord(a) && isRecord(b) ? sameFields(a, b) : a === b
}

/** C2-A-162: only typed nodes have geometry and the generated resolution results. */
function skipped(node: Fields, name: string, spanMarks: boolean): boolean {
  const type = node['type']
  if (typeof type !== 'string' || !AST_RESULTS.has(type)) return false
  if (name === 'pos' || name === 'segments' || name === 'srcByteLength') return true
  const result = AST_RESULTS.get(type)?.find((entry) => entry.field === name)
  if (result === undefined) return false
  if (result.when === 'reference use') return node['key'] !== undefined
  if (result.when === 'derived from authored span mark') return spanMarks
  return true
}

function isCompared(c: Check, node: Node, name: string): boolean {
  if (NODE_SLOTS.includes(name)) return false
  if (name === 'data' && node.data !== undefined && Object.keys(node.data).every((key) => IGNORED_DATA.has(key))) return false
  if (name === 'title') return titleOf(node) === undefined
  return !isRecord(node) || !skipped(node, name, c.spanMarks)
}

/**
 * C2-W-136, C2-W-050: the `attrs` of `e` as the parse holds them: without the keys the writer reported and did not
 * write, and with each value in the spelling the writer gave it.
 */
function writtenAttrs(c: Check, e: Node): unknown {
  const keys = c.w.lostKeys.get(e)
  const attrs = e.attrs
  if (attrs === undefined) return attrs
  const respelled = attrs.keyValues?.some(([, value]) => value.includes('\n')) === true
  if (keys === undefined && !respelled) return attrs
  const keyValues = (attrs.keyValues ?? []).filter(([key]) => keys === undefined || !keys.includes(key))
    .map(([key, value]): [string, string] => [key, spelledValue(value)])
  const rest: Fields = { ...attrs, keyValues: keyValues.length === 0 ? undefined : keyValues }
  return rest['id'] === undefined && (attrs.classes ?? []).length === 0 && keyValues.length === 0 ? undefined : rest
}

/** The name of the first field in which `e` and `a` differ, or null. */
function differingField(c: Check, e: Node, a: Node): string | null {
  // Every node is a record; the guard gives the fields of both by name.
  if (!isRecord(e) || !isRecord(a)) return null
  for (const name in e) {
    const value = name === 'attrs' ? writtenAttrs(c, e) : e[name]
    if (value !== undefined && isCompared(c, e, name) && !sameValue(value, a[name])) return name
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

export function isEscaped(c: Check, node: TextNode, at: number): boolean {
  const asked = c.marks.get(node)?.get(at)
  if (asked !== undefined) return asked
  const written = c.w.escapes.get(node) ?? []
  return written[firstFrom(written, at)] === at
}

/** Asks for a backslash before the character `at` of the text node. False where that character takes none. */
export function escapeAt(c: Check, node: TextNode, at: number): boolean {
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
export function openerOffsets(value: string): number[] {
  const offsets: number[] = []
  if (value.startsWith('--')) offsets.push(1)
  offsets.push(0)
  let end = 0
  while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
  if (end > 0 && (value[end] === '.' || value[end] === ')')) offsets.push(end)
  return offsets
}

/** The text nodes from `nodes[from]` up to the first other node: the opener of a line may span them (C2-W-092). */
function leadingTexts(nodes: readonly Node[], from: number): TextNode[] {
  const texts: TextNode[] = []
  for (let at = from; nodes[at]?.type === 'text'; at++) texts.push(nodes[at] as TextNode)
  return texts
}

function joinedValue(texts: readonly TextNode[]): string {
  return texts.length === 1 ? texts[0]!.value : texts.map((text) => text.value).join('')
}

/** Escapes the opener of the text that `texts` hold joined, at the character it falls on in whichever node. */
function escapeLeadingOpener(c: Check, texts: readonly TextNode[]): boolean {
  if (texts.length === 0) return false
  for (let offset of openerOffsets(joinedValue(texts))) {
    let k = 0
    while (k < texts.length - 1 && offset >= texts[k]!.value.length) offset -= texts[k++]!.value.length
    if (!escapeAt(c, texts[k]!, offset)) continue
    // C2-W-088: the line kind is read from the first text of the line; a run split over nodes gives no kind.
    const escapes = k === 0 ? c.lineEscapes : c.ownEscapes
    escapes.set(texts[k]!, (escapes.get(texts[k]!) ?? new Set<number>()).add(offset))
    return true
  }
  return false
}

/** The line that starts at `nodes[from]` opened a block: escapes its opener (C2-W-090, C2-W-092). */
function escapeLineStart(c: Check, nodes: readonly Node[], from: number, owner: Node): void {
  c.misaligned = true
  if (escapeAttributeLinesAbove(c, nodes, from, owner)) return
  const first = nodes[from]
  if (escapeLeadingOpener(c, leadingTexts(nodes, from))) return
  for (let at = from + 1; at < nodes.length && !isBreak(nodes[at]); at++) {
    const node = nodes[at]
    if (node?.type === 'text' && escapeAt(c, node, 0)) return
  }
  // The markup of the first node of the line reads as a block opener: its other spelling may not (C2-W-005).
  if (first !== undefined && hasOtherForm(c, first)) changeForm(c, first)
  else c.losses.push([first ?? owner, null])
}

/**
 * C2-I-028: where every line of the block above `nodes[from]` is a whole attribute block, they read as attribute lines
 * and the line at `from` starts a block of its own; the first brace takes the backslash (C2-W-125 case one).
 */
function escapeAttributeLinesAbove(c: Check, nodes: readonly Node[], from: number, owner: Node): boolean {
  const first = nodes[0]
  if (first?.type !== 'text' || from === 0 || !isBreak(nodes[from - 1]) || childNodes(owner)[0] !== first) return false
  let line = ''
  for (let at = 0; at < from; at++) {
    const node = nodes[at]!
    if (isBreak(node)) {
      const text = line.replace(/[ \t]+$/u, '')
      if (text[0] !== '{' || readAttributeBlock(text, 0, text.length, emptyMemo(), null) !== text.length) return false
      line = ''
    } else if (node.type === 'text') line += node.value
    else return false
  }
  return escapeAt(c, first, 0)
}

function hasOtherForm(c: Check, node: Node): boolean {
  if ((c.w.forms.get(node) ?? 0) > 0 || c.respelled.has(node)) return false
  // C2-W-069: a pair braced for its content or place has no bare form; asking for one would only restart the rounds.
  if (node.type === 'emphasis' || node.type === 'strong') return !c.w.bracedAnyway.has(node)
  if (node.type === 'comment') return true
  return recordedRaw(c.w, node) !== undefined
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

/** Whether `value` holds, from `at` on, spaces or tabs and then a CR. */
function endsLineWithCr(value: string, at: number): boolean {
  let k = at
  while (value[k] === ' ' || value[k] === '\t') k++
  return value.charCodeAt(k) === CR
}

/** The characters that read on into markup that stands directly behind them: `\\(`, `![`, `^[`, `$` and a backtick run. */
const JOINING = '\\!^$`'
/** The closing mark of each node that has one, for the escape of that mark in its content (C2-W-093). */
export const CLOSING_MARKS: ReadonlyMap<string, string> = new Map([
  ['emphasis', '/'], ['strong', '*'], ['underline', '_'], ['strike', '~'], ['highlight', '='], ['superscript', '^'], ['subscript', ','],
  ['insert', '+'], ['delete', '-'], ['span', ']'], ['link', ']'], ['inline_footnote', ']'], ['inline_extension', ']'],
])

/**
 * Asks for a backslash in `text` where its end reads on into the markup behind it: before a last
 * character that joins that markup, or else before its last opening brace, which may open a brace
 * form that takes the markup (C2-I-043).
 */
function escapeEnd(c: Check, text: TextNode | null, braces: boolean, behind: string | null = null): boolean {
  if (text === null) return false
  const value = text.value
  const last = value[value.length - 1]
  if (last !== undefined && JOINING.includes(last) && (behind === null || joins(last, behind)) &&
    escapeAt(c, text, value.length - 1)) return true
  return braces && escapeAt(c, text, value.lastIndexOf('{'))
}

/**
 * Whether the character `last` reads on into the markup `behind`: a backslash escapes it, a backtick run opens a code
 * span over it, `!` and `^` join a bracket and `$` a backtick. Before any other markup it is text, and the brace of
 * C2-W-125, case one, is tried.
 */
function joins(last: string, behind: string): boolean {
  if (last === '\\' || last === '`') return behind !== ''
  return last === '$' ? behind.startsWith('`') : behind.startsWith('[')
}

/**
 * Asks for a backslash before the first bare closing mark of `e` in its content, or before the first bracket in it.
 * C2-W-125, case five: of brackets, each bare `]` that closes no bare `[` of the content ends `e` early in turn, so all
 * of them take one in this round. Where there is none, each bare `[` that no `]` of the content closes takes the
 * closer behind the content, and those take it, where the parse holds no bracket construct of its own there; a
 * bracket pair of the content stays bare.
 */
function escapeInContent(c: Check, e: Node): boolean {
  const mark = CLOSING_MARKS.get(e.type)
  if (mark === undefined || !('children' in e)) return false
  if (mark === ']' && (escapeLoneClosers(c, e) || (!readsBracketConstruct(c, e) && escapeUnclosedBrackets(c, e)))) return true
  return escapeCloser(c, e.children, 0, 0, mark) || (mark === ']' && escapeMark(c, e.children, 0, 0, '['))
}

function escapeLoneClosers(c: Check, e: Node): boolean {
  let asked = false
  for (const [text, at, partner] of contentClosers(childNodes(e), (node, offset) => !isEscaped(c, node, offset), null)) {
    if (partner === null) asked = escapeAt(c, text, at) || asked
  }
  return asked
}

/** The nodes whose content a `]` closes. */
export const BRACKETED: ReadonlySet<string> = new Set(['link', 'span', 'inline_footnote', 'inline_extension'])

/**
 * The bare `]` in `nodes`, the content of a bracketed node, each with the bare `[` of that content it closes, or
 * null. A bracketed node inside has its own content: it is skipped, or pushed to `inner` where that is given.
 */
export function contentClosers(nodes: readonly Node[], bare: (node: TextNode, at: number) => boolean,
  inner: Node[] | null, open: [TextNode, number][] = []): Closer[] {
  const closers: Closer[] = []
  const pending = [...nodes].reverse()
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (BRACKETED.has(node.type)) inner?.push(node)
    else if (node.type === 'text') pairBrackets(node, bare, open, closers)
    else {
      const children = childNodes(node)
      for (let at = children.length - 1; at >= 0; at--) pending.push(children[at]!)
    }
  }
  return closers
}

type Closer = [TextNode, number, [TextNode, number] | null]

function pairBrackets(node: TextNode, bare: (node: TextNode, at: number) => boolean, open: [TextNode, number][],
  closers: Closer[]): void {
  const value = node.value
  for (let at = 0; at < value.length; at++) {
    const ch = value.charCodeAt(at)
    if ((ch !== OPEN_BRACKET && ch !== CLOSE_BRACKET) || !bare(node, at)) continue
    if (ch === OPEN_BRACKET) open.push([node, at])
    else closers.push([node, at, open.pop() ?? null])
  }
}

const OPEN_BRACKET = 0x5b
const CLOSE_BRACKET = 0x5d

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
  if (mark === ']' && BRACKETED.has(c.owner!.type)) return false
  // C2-W-069, C2-W-093: a paired owner whose delimiter pairs in the content takes the braced form, as in `closedEarly`.
  if (isPaired(c.owner!) && hasOtherForm(c, c.owner!) && textsBelow(e).some((text) => holdsPairingMark(text.value, mark))) {
    changeForm(c, c.owner!)
    return true
  }
  return escapeCloser(c, e.children, 0, 0, mark) || (mark === ']' && escapeMark(c, e.children, 0, 0, '['))
}

/**
 * C2-W-125, case five: the bare `]` below `e` that close no bare `[` of the content of the bracketed node around `e`,
 * or else the bare `[` below `e` that no `]` of that content closes. A bracket pair of the content reads as text and
 * stays bare. Like `escapeLoneBracket` it is no trial: the round behind it can still fail on a bracket it fixes later.
 */
function escapeOwnerBrackets(c: Check, es: readonly Node[], i: number): boolean {
  const owner = c.owner
  const e = es[i]!
  if (owner === null || !BRACKETED.has(owner.type) || !('children' in e)) return false
  const below = new Set(textsBelow(e))
  const open: [TextNode, number][] = []
  let asked = false
  for (const [text, at, partner] of contentClosers(childNodes(owner), (node, offset) => !isEscaped(c, node, offset), null, open)) {
    if (partner === null && below.has(text)) asked = escapeBracket(c, text, at) || asked
  }
  for (const [text, at] of asked ? [] : open) if (below.has(text)) asked = escapeBracket(c, text, at) || asked
  return asked
}

/** Asks for the escape that keeps the text before `es[i]` from reading on into its opening markup. */
function escapeBefore(c: Check, es: readonly Node[], i: number): boolean {
  const before = i > 0 ? lastText(es[i - 1]) : null
  return escapeEnd(c, before, true) || escapeNameSigil(c, before, es[i]!)
}

/** C2-W-125, case three: the sigil `:name` glued before the bracket of `e` reads it as an extension, so its colon takes the backslash. */
function escapeNameSigil(c: Check, text: TextNode | null, e: Node): boolean {
  if (text === null || !writeInlines(c.w, [e], c.flags).startsWith('[')) return false
  const value = text.value
  let start = value.length
  while (start > 0 && isExtensionNameChar(value.charCodeAt(start - 1))) start--
  // C2-I-094: the name starts with a letter or `_`.
  while (start < value.length && (value[start] === '-' || (value.charCodeAt(start) >= 48 && value.charCodeAt(start) <= 57))) start++
  return start < value.length && value[start - 1] === ':' && escapeAt(c, text, start - 1)
}

/** C2-I-094: a character of the name of an inline extension after its first. */
function isExtensionNameChar(code: number): boolean {
  return isAsciiAlphanumeric(code) || code === 95 || code === 45
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

/** An opener in superscript text mixed with other content can take the wrapper's closer. */
function escapeContentOpener(c: Check, es: readonly Node[], i: number): boolean {
  const e = es[i]!
  if (e.type !== 'superscript') return false
  const mark = CLOSING_MARKS.get(e.type)
  if (mark === undefined || !('children' in e)) return false
  let found = false
  for (const child of e.children) {
    // A run made entirely of openers follows the ordinary repair and budget rule.
    if (child.type !== 'text' || !/[^{^]/.test(child.value)) continue
    for (let at = child.value.indexOf(`{${mark}`); at >= 0; at = child.value.indexOf(`{${mark}`, at + 1)) {
      found = escapeAt(c, child, at) || found
    }
  }
  return found
}

function escapeFootnoteBrace(c: Check, e: Node): boolean {
  if (e.type !== 'inline_footnote') return false
  const first = e.children[0]
  const last = e.children.at(-1)
  if (first?.type !== 'text' || last?.type !== 'comment' || last.form !== 'line') return false
  if (!e.children.some((node) => node.type === 'strong' || node.type === 'emphasis')) return false
  const brace = first.value.search(/\{[*/]/)
  return brace >= 0 && escapeAt(c, first, brace)
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
  if (e === undefined || !('children' in e)) return false
  return escapeEnd(c, lastText(e), true, closerOf(c.w, e, c.flags))
}

/** C2-W-125, case five: a closer in content precedes a brace that follows the node. */
function escapeCloserBeforeBrace(c: Check, es: readonly Node[], i: number): boolean {
  const e = es[i]
  const next = es[i + 1]
  if (e === undefined || next?.type !== 'text' || !next.value.startsWith('}')) return false
  if (lastText(e)?.value.includes('{') !== true) return false
  return escapeInContent(c, e)
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
  // Nor does any spelling of a node whose lost break left a blank line in it (C2-W-124).
  if (c.w.lost.has(e) || holdsLostBreak(c, e)) return false
  // Its escapes would only serve a node around it, and none can form; each level probed its subtree (carve#6543).
  if (noneForms(c, e)) {
    c.losses.push([e, null])
    return false
  }
  const attempt = c.w.attempts.get(e) ?? { step: 0, escapes: [] }
  c.w.attempts.set(e, attempt)
  const before = c.escapes.length
  while (attempt.step < RESPELL_STEPS.length) {
    const step = RESPELL_STEPS[attempt.step++]!
    if (!step(c, es, i, attempt)) continue
    for (let at = before; at < c.escapes.length; at++) {
      attempt.escapes.push(c.escapes[at]!)
      if (isTrial(c, step, c.escapes[at]!)) addTrial(c, step, c.escapes[at]!)
    }
    // A deferred escape can leave another opener for the next round.
    if (step === escapeContentOpener) attempt.step--
    return true
  }
  c.losses.push([e, null])
  return false
}

type RespellStep = (c: Check, es: readonly Node[], i: number, attempt: Attempt) => boolean

/** Records the escape a step asked for as a trial, with what the round needs to know of it. */
function addTrial(c: Check, step: RespellStep, escape: [TextNode, number]): void {
  c.trials.push(escape)
  if (step === contentStart) c.leadTrials.add(escape)
  if (stopsCodeSpan(step, escape)) c.codeTrials.add(escape)
}

/** The other spelling of `es[i]`, without the escapes the steps before asked for. */
function otherForm(c: Check, es: readonly Node[], i: number, attempt: Attempt): boolean {
  for (const escape of attempt.escapes) {
    c.retracted.push(escape)
    mark(c, escape[0], escape[1], false)
  }
  attempt.escapes = []
  changeForm(c, es[i]!)
  return true
}

/** Whether the escape a step asked for is a C2-W-125 trial, which the round tests on its own and which gives no kind. */
function isTrial(c: Check, step: RespellStep, escape: [TextNode, number]): boolean {
  return step !== escapeLoneBracket && step !== escapeOwnerBrackets && !c.reported.has(escape)
}

/**
 * C2-W-088: a backtick that a probe of the content escapes can open a code span the tree does not hold. Where the
 * trial shows the escape is asked, the parse holds that span, which reports the backtick kind; C2-W-125 covers only
 * a character that opens nothing.
 */
function stopsCodeSpan(step: RespellStep, [node, at]: [TextNode, number]): boolean {
  return (step === escapeAcrossCloser || step === contentConstruct || step === escapeInside) && node.value[at] === '`'
}

const contentConstruct: RespellStep = (c, es, i) => escapeContentConstruct(c, es[i]!)
const contentStart: RespellStep = (c, es, i) => escapeContentStart(c, es[i]!)
const braceAtContentEnd: RespellStep = (c, es, i) => {
  const node = es[i]!
  // Case one leads only when this parse formed no node of this kind. Otherwise the
  // construct that did form is reported by the kind round before a trial is made.
  return c.parsed.every((candidate) => candidate.type === 'text') && escapeOpeningBrace(c, node)
}
const contentBraceBeforeStart: RespellStep = (c, es, i) => {
  const node = es[i]!
  const mark = CLOSING_MARKS.get(node.type)
  const first = childNodes(node)[0]
  // C2-W-125: case one precedes the content-start trial where both could form this node.
  return mark !== undefined && first?.type === 'text' && first.value.startsWith(mark) &&
    escapeOpeningBrace(c, node)
}

// C2-W-088: the leftmost construct takes the backslash first, so a construct inside the content is
// escaped before the end of the content and the text behind the node.
const RESPELL_STEPS: readonly RespellStep[] = [
  braceAtContentEnd,
  escapeBefore,
  (c, es, i, attempt) => markAtContentEdge(c, es[i]!) && otherForm(c, es, i, attempt),
  contentBraceBeforeStart,
  contentStart,
  (c, es, i) => escapeFootnoteBrace(c, es[i]!),
  contentConstruct,
  escapeContentOpener,
  escapeAcrossCloser,
  escapeInside,
  escapeCloserBeforeBrace,
  // C2-W-125: case five precedes case six, so a lone `[` of the content is escaped before the text behind the node.
  (c, es, i) => !readsOtherBracketConstruct(c, es, i) && escapeUnclosedBrackets(c, es[i]!),
  escapeAfter,
  (c, es, i) => escapeContentLine(c, es[i]!),
  escapeOwnerBrackets,
  (c, es, i) => escapeOwnerMark(c, es[i]!),
  (c, es, i, attempt) => hasOtherForm(c, es[i]!) && otherForm(c, es, i, attempt),
  escapeBefore,
  escapeInside,
  (c, es, i) => escapeInContent(c, es[i]!),
  escapeLoneBracket,
  escapeTextNote,
  (c, es, i) => escapeKeyCaret(c, es[i]!),
  inContentAlone,
  (c, es, i) => escapeNoteCaret(c, es[i]!),
  escapeAttributeKey,
]

/**
 * C2-W-125, case nine: the braced opener of `es[i]` reads as the key of a valid attribute block (C2-I-043). A key that
 * starts with `_` is valid only with a value (C2-I-031), so the `=` behind the key characters of the content takes the
 * backslash: an underline of `=.` is `{_\=._}`, of `a-b=c` is `{_a-b\=c_}`.
 */
function escapeAttributeKey(c: Check, es: readonly Node[], i: number): boolean {
  const first = childNodes(es[i]!)[0]
  if (first?.type !== 'text') return false
  const text = writeInlines(c.w, es.slice(i), c.flags)
  if (text[0] !== '{' || readAttributeBlock(text, 0, text.length, emptyMemo(), null) < 0) return false
  const equals = classRunEnd(first.value, 0, first.value.length, CLASS_KEY_REST)
  return first.value[equals] === '=' && escapeAt(c, first, equals)
}

/**
 * C2-W-125: the backslash of a closer in the content is taken back on its own, without the earlier trials for the
 * same node, which can be the ones that keep it from forming (a trailing caret of the span text `][^`).
 */
function inContentAlone(c: Check, es: readonly Node[], i: number, attempt: Attempt): boolean {
  if (attempt.escapes.length < 2) return false
  for (const escape of attempt.escapes) {
    c.retracted.push(escape)
    mark(c, escape[0], escape[1], false)
  }
  attempt.escapes = []
  escapeInContent(c, es[i]!)
  return true
}

/**
 * C2-W-125, case five: the leading caret of a reference whose key is its content is written bare (write-inline.ts), and
 * takes the backslash only where the bare caret keeps the link from forming.
 */
function escapeKeyCaret(c: Check, e: Node): boolean {
  if (e.type !== 'link' || (c.flags & IN_NOTE) !== 0 || !keyIsContent(e)) return false
  const first = e.children[0]
  return first?.type === 'text' && first.value.startsWith('^') && !isEscaped(c, first, 0) && escapeAt(c, first, 0)
}

/**
 * C2-I-089, C2-W-125, case five: link or span text in a note is written with its leading caret bare, which holds there
 * only while the note closes. Where the note did not form, that caret pair kept it open, so each such caret is tried.
 */
function escapeNoteCaret(c: Check, e: Node): boolean {
  if (e.type !== 'inline_footnote') return false
  let asked = false
  for (const child of e.children) {
    const first = 'children' in child ? child.children[0] : undefined
    if (leadingCaret(child) && first?.type === 'text' && !isEscaped(c, first, 0)) asked = escapeAt(c, first, 0) || asked
  }
  return asked
}

/**
 * C2-I-089, C2-W-125: a `^[` of text before `es[i]` that reads as a note closing only through a caret pair in it is
 * text, and its caret pairs are ordinary brackets, so a node of the tree in its span does not form. Its bracket takes
 * the backslash (C2-W-090).
 */
function escapeTextNote(c: Check, es: readonly Node[], i: number): boolean {
  // Escaping one opener can make the next `^[` such a note, so each `^[` of text before the node takes one.
  let asked = false
  for (let j = 0; j < i; j++) {
    const text = es[j]!
    if (text.type !== 'text') continue
    for (let at = text.value.indexOf('^['); at >= 0; at = text.value.indexOf('^[', at + 1)) {
      if (!isEscaped(c, text, at) && !isEscaped(c, text, at + 1)) asked = escapeAt(c, text, at + 1) || asked
    }
  }
  return asked
}

/**
 * C2-W-125: a lone bracket in the content of an inline footnote or extension, where its closer was not asked for.
 * The clause places it for the node that did not form, so it is no trial: the test of a trial takes
 * out the escapes behind it, which this one may need.
 */
function escapeLoneBracket(c: Check, es: readonly Node[], i: number): boolean {
  const e = es[i]!
  if ((e.type !== 'inline_footnote' && e.type !== 'inline_extension') || !('children' in e)) return false
  const open = unclosedOpeners(c, e)
  let asked = false
  // C2-W-088: where the parse holds no construct of its own there, the backslash is one of C2-W-125 and gives no kind.
  const kindless = !readsBracketConstruct(c, e)
  for (const [text, at] of open) asked = (kindless ? escapeBracket(c, text, at) : escapeAt(c, text, at)) || asked
  return asked || escapeMark(c, e.children as Node[], 0, 0, '[')
}

function escapeUnclosedOpeners(c: Check, e: Node): boolean {
  let asked = false
  for (const [text, at] of unclosedOpeners(c, e)) asked = escapeAt(c, text, at) || asked
  return asked
}

/** Each bracket of the content of `e` that no later `]` of it closes. */
function unclosedOpeners(c: Check, e: Node): [TextNode, number][] {
  const open: [TextNode, number][] = []
  for (const text of textsBelow(e)) {
    for (let at = 0; at < text.value.length; at++) {
      const char = text.value[at]
      if ((char !== '[' && char !== ']') || isEscaped(c, text, at)) continue
      if (char === '[') open.push([text, at])
      else open.pop()
    }
  }
  return open
}

/** C2-W-125 case five: brackets inside a note that would take its own closer. */
export function earlyLoneNoteBrackets(w: Writer, roots: readonly Node[]): [TextNode, number][] {
  const check = createCheck(w)
  const found: [TextNode, number][] = []
  const pending = [...roots]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'inline_footnote') pushAll(found, earlyNoteOpeners(check, node))
    const children = childNodes(node)
    priorNoteOpeners(check, children, found)
    pushAll(pending, children)
  }
  return found
}

/**
 * C2-W-125 case eight: a text `^[` stays bare before a later link whose text is a caret, so the `]` that closed it early
 * takes the backslash before the first write. Only the first such link behind the closers keeps its caret bare, since a
 * later bare caret could close a caret pair with it; not a collapsed or shortcut reference, which spells its caret
 * through its key, nor a reference written as authored (C2-W-075). Another node between leaves the case to the rounds.
 */
export function earlyTextNoteClosers(roots: readonly Node[], w?: Writer): [TextNode, number][] {
  const found: [TextNode, number][] = []
  const pending = [...roots]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    const children = childNodes(node)
    scanTextNoteClosers(w, children, found)
    pushAll(pending, children)
  }
  return found
}

function scanTextNoteClosers(w: Writer | undefined, children: readonly Node[], found: [TextNode, number][]): void {
  if (!children.some((child) => child.type === 'link' && caretText(child))) return
  // With its closers escaped the note stays open, so each `]` at its own depth closes it early.
  const scan: TextNoteScan = { depth: 0, closers: [] }
  for (const child of children) {
    if (child.type === 'text') scanTextNote(child, scan)
    else if (child.type === 'link' && caretText(child) && scan.closers.length > 0) {
      pushAll(found, scan.closers)
      if (child.refForm !== 'collapsed' && child.refForm !== 'shortcut' && bareAuthoredCaret(w, child)) w?.caseEightLinks.add(child)
      scan.closers = []
      scan.depth = 0
    } else if (!isBreak(child)) {
      scan.closers = []
      scan.depth = 0
    }
  }
}

/** Link text that is a lone caret: `^a` or `^ a` would read as a footnote key, and the rounds decide those. */
function caretText(link: LinkNode): boolean {
  const first = link.children[0]
  return link.children.length === 1 && first?.type === 'text' && first.value === '^'
}

/** C2-W-075: a reference written as authored keeps its caret as spelled, so only a bare one keeps it bare here. */
function bareAuthoredCaret(w: Writer | undefined, link: LinkNode): boolean {
  const raw = w === undefined ? undefined : recordedRaw(w, link)
  return raw === undefined || raw.startsWith('[^')
}

interface TextNoteScan { depth: number, closers: [TextNode, number][] }

function scanTextNote(text: TextNode, scan: TextNoteScan): void {
  const value = text.value
  for (let at = 0; at < value.length; at++) {
    if (scan.depth === 0 && value.startsWith('^[', at)) { scan.depth = 1; scan.closers = []; at++ }
    else if (scan.depth > 0 && value[at] === '[') scan.depth++
    else if (scan.depth === 1 && value[at] === ']') scan.closers.push([text, at])
    else if (scan.depth > 1 && value[at] === ']') scan.depth--
  }
}

function priorNoteOpeners(check: Check, children: readonly Node[], found: [TextNode, number][]): void {
  const open: [TextNode, number][] = []
  for (const child of children) {
    if (child.type === 'text') {
      for (let at = 0; at < child.value.length; at++) {
        if (child.value.startsWith('^[', at)) { open.push([child, at + 1]); at++ }
        else if (child.value[at] === ']' && open.length > 0) open.pop()
      }
    } else if (child.type === 'inline_footnote' && earlyNoteOpeners(check, child).length > 0) {
      pushAll(found, open)
    }
  }
}

/** Inside a note, these caret pairs are literal text and cannot open another note. */
function earlyNoteOpeners(check: Check, node: Node): [TextNode, number][] {
  if (node.type !== 'inline_footnote' || !node.children.every((child) => child.type === 'text') ||
    !node.children.some((child) => child.type === 'text' && child.value.includes('^['))) return []
  const open = unclosedOpeners(check, node)
  const first = open[0]
  if (first === undefined) return []
  let before = ''
  for (const child of node.children) {
    if (child.type !== 'text') continue
    before += child === first[0] ? child.value.slice(0, first[1]) : child.value
    if (child === first[0]) break
  }
  // A completed pair before the lone opener can have reported the `[` kind in the bare round.
  return before.includes(']') ? [] : open
}

/** The flags the content of `e` is written with. */
function contentFlags(c: Check, e: Node): number {
  return c.flags | contentFlag(e.type)
}

// The content of a note is written with IN_NOTE (write-inline.ts); a spelling without it escapes a leading caret of a link.
function contentFlag(type: string): number {
  return type === 'emphasis' ? IN_EMPHASIS : type === 'strong' ? IN_STRONG : type === 'link' ? IN_BRACKET :
    type === 'inline_footnote' ? IN_NOTE : 0
}

// The rounds of one probe: past it, the step runs again in the next round of the writer.
const MAX_PROBE_ROUNDS = 32

type Takes = (node: TextNode, at: number) => boolean

/**
 * The writer of a probe of the inlines `expected`: its own attempts, losses and escapes, so that what
 * it finds stays out of this round until it is taken over. Only the escapes of the probed text nodes
 * are read, so only those are copied.
 */
function probeWriter(c: Check, expected: readonly Node[]): Writer {
  const escapes = new Map<TextNode, number[]>()
  for (const text of expected.flatMap((node) => (node.type === 'text' ? [node] : textsBelow(node)))) {
    const own = c.w.escapes.get(text)
    if (own !== undefined) escapes.set(text, [...own])
  }
  return { ...c.w, escapes, attempts: new Map(), losses: { entries: [], nodes: [] }, lost: new Set(c.w.lost),
    lostKeys: new Map(c.w.lostKeys) }
}

/** Where a probe is made, which fixes the escapes it may take over: the content of a node, or the content across its closer. */
type ProbeSite = 'content' | 'across'

/**
 * C2-W-088 on the inlines `expected` of `e` written and parsed on their own: while the parse holds a
 * construct that the tree does not, the opener of the leftmost one takes the backslash and they are
 * parsed again. The escapes that `takes` accepts go to `c` as escapes of this round. Null where the
 * inlines do not read as one paragraph, which tells nothing; otherwise whether an escape was asked for.
 * The comparison inside a probe probes the next level of nesting, so a probe is made once for each
 * state it reads (`probeKey`) and replayed after; without that, its cost grows with 3 to the power of the depth.
 */
function probeEscapes(c: Check, e: Node, expected: readonly Node[], flags: number, site: ProbeSite, takes: Takes): boolean | null {
  const key = probeKey(c, e, expected, flags, site)
  const known = c.w.probes.get(key)
  if (known !== undefined) {
    for (const [node, at] of known.taken) escapeAt(c, node, at)
    for (const escape of known.leads ?? []) markLead(c, escape)
    return known.found
  }
  const before = c.escapes.length
  const found = runProbe(c, e, expected, flags, takes)
  const taken = c.escapes.slice(before)
  // A probe cut short by the limit is not kept: its group is refused (C2-W-133).
  if (!exhausted(c.w)) c.w.probes.set(key, { found, taken, leads: taken.filter((escape) => c.leadTrials.has(escape)) })
  return found
}

function runProbe(c: Check, e: Node, expected: readonly Node[], flags: number, takes: Takes): boolean | null {
  const w = probeWriter(c, expected)
  let found = false
  for (let round = 0; round < MAX_PROBE_ROUNDS; round++) {
    // C2-W-133: past the repair limit the group is refused after this round, so nothing more is probed.
    if (exhausted(c.w)) return found
    const taken = probeRound(c, w, e, expected, flags, takes)
    // A first parse that is no paragraph, or that differs where no escape helps, as a content that starts with a
    // line break, tells nothing.
    if (taken === null) return round === 0 ? null : found
    if (taken.length === 0) return found
    found = true
    // One copy and one sort per node and round: one per escape made a node with many escapes quadratic.
    const added = new Map<TextNode, number[]>()
    for (const [node, at] of taken) {
      const list = added.get(node) ?? [...(w.escapes.get(node) ?? [])]
      list.push(at)
      added.set(node, list)
    }
    for (const [node, list] of added) w.escapes.set(node, list.sort((x, y) => x - y))
  }
  return found
}

/** One round of a probe: the escapes it takes over into `c`, or null where its parse tells nothing. */
function probeRound(c: Check, w: Writer, e: Node, expected: readonly Node[], flags: number, takes: Takes): [TextNode, number][] | null {
  const source = `${writeInlines(w, expected, flags)}\n`
  const parsed = parseChunk(c.w, source).children
  const block = parsed[0]
  if (parsed.length !== 1 || block?.type !== 'paragraph') return null
  const probe = createCheck(w)
  probe.formsAround = c.formsAround || !unformable(e, c.flags) || c.around.some(([list, at, around]) => !unformable(list[at]!, around))
  probe.flags = flags
  probe.source = source
  if (e.type === 'inline_footnote' && !readsBracketConstruct(c, e)) probe.note = e
  compareInlines(probe, expected, block.children, e)
  // C2-W-125, case five: the lone brackets of such a note keep it open in its context, which the probe does not read.
  if (probe.note !== null) {
    const before = probe.escapes.length
    escapeUnclosedOpeners(probe, probe.note)
    for (const escape of probe.escapes.slice(before)) probe.closers.add(escape)
  }
  // C2-W-088: a probe round escapes every opener of each kind its parse reports in the probed leaf block, as a round
  // of the group does; where that loses a node, the group runs again without kinds (CC-1633), and so do its probes.
  // A closer that ended a node early is no reported construct: its backslash is C2-W-125's and gives no kind (CC-1568).
  if (w.kindRounds) {
    const leaf: Node[] = [{ type: 'paragraph', children: expected } as ParagraphNode]
    escapeKinds(probe, leaf, new Set([...probe.closers, ...probe.readOn]))
    escapePartnerClosers(probe, leaf)
  }
  extendChains(probe)
  const taken = probe.escapes.filter(([node, at]) => takes(node, at) && escapeAt(c, node, at))
  for (const escape of probe.leadTrials) if (taken.includes(escape)) markLead(c, escape)
  return taken.length === 0 && probe.losses.length > 0 ? null : taken
}

/** Marks the escape `[node, at]` that `c` holds as a content-start trial, which the round tests in its context. */
function markLead(c: Check, [node, at]: [TextNode, number]): void {
  const own = c.escapes.find((escape) => escape[0] === node && escape[1] === at)
  if (own !== undefined) c.leadTrials.add(own)
}

/** The id of `node` for the keys of the probes: one per node object. */
function nodeIdOf(w: Writer, node: Node): number {
  const known = w.nodeIds.get(node)
  if (known !== undefined) return known
  const id = w.nodeIds.size
  w.nodeIds.set(node, id)
  return id
}

/**
 * The text `value` that stands in a probe for markup beside `anchor`, as the word before a content. A probe below
 * may escape it, so a probe made again must see the same node, or its result names a node no longer written.
 */
function standIn(w: Writer, anchor: Node, role: string, value: string): TextNode {
  const roles = w.standIns.get(anchor) ?? new Map<string, TextNode>()
  w.standIns.set(anchor, roles)
  const name = `${role} ${value}`
  const known = roles.get(name)
  if (known !== undefined) return known
  const node: TextNode = { type: 'text', value }
  roles.set(name, node)
  return node
}

/**
 * The state a probe reads, as a key: the site, the flags, the probed node and its state, the inlines,
 * and of each node below them what the writer and `c` hold for it. The rest of what the writer reads is fixed for one write.
 */
function probeKey(c: Check, e: Node, expected: readonly Node[], flags: number, site: ProbeSite): string {
  const w = c.w
  // The comparison reads the form of `e` itself where its content ends early (`closedEarly`).
  const parts: unknown[] = [site, flags, w.kindRounds, nodeIdOf(w, e), nodeState(c, e)]
  for (const node of expected) parts.push(nodeIdOf(w, node))
  const pending = [...expected]
  for (;;) {
    const node = pending.pop()
    if (node === undefined) break
    for (const child of childNodes(node)) pending.push(child)
    const state = nodeState(c, node)
    if (state !== null) parts.push(nodeIdOf(w, node), state)
  }
  return JSON.stringify(parts)
}

/** What the writer and the comparison `c` hold for `node`, or null where it holds nothing. */
function nodeState(c: Check, node: Node): unknown[] | null {
  const w = c.w
  const escapes = node.type === 'text' ? w.escapes.get(node) : undefined
  const marks = node.type === 'text' ? c.marks.get(node) : undefined
  const form = w.forms.get(node)
  const keys = w.lostKeys.get(node)
  const lost = w.lost.has(node)
  if (escapes === undefined && marks === undefined && form === undefined && keys === undefined && !lost) return null
  return [escapes, marks === undefined ? undefined : [...marks], form, keys, lost]
}

/**
 * C2-W-088: the content of `e`, written and parsed on its own, holds a construct that the tree
 * does not, such as a code span that runs on over the closing mark of `e`. The opener of the
 * leftmost one takes the backslash, then that of the next. A content that does not read as one
 * paragraph tells nothing.
 */
function escapeContentConstruct(c: Check, e: Node): boolean {
  if (!('children' in e) || e.children.length === 0) return false
  // A content that opens a block on its own line is read again behind a word, which opens none, and
  // then with its line breaks as spaces, so that no later line opens one either.
  const word: Node = standIn(c.w, e, 'word', 'x')
  const flat = e.children.map((node): Node => (node.type === 'soft_break' ? standIn(c.w, node, 'space', ' ') : node))
  // A content that starts with a line break reads as a paragraph only behind the word.
  const variants = isBreak(e.children[0]) ? [[word, ...e.children], [word, ...flat]] : [e.children, [word, ...e.children], [word, ...flat]]
  for (const expected of variants) {
    const found = probeEscapes(c, e, expected, contentFlags(c, e), 'content', () => true)
    if (found !== null) return found
  }
  return false
}

/**
 * C2-W-088: a construct that opens in the content of the paired node `es[i]` and runs on over its
 * closing mark into the inlines behind it, as `^[` in emphasis before a `]` behind it, keeps the
 * node from forming. The content, the closing mark as text and the inlines behind it are probed together.
 */
function escapeAcrossCloser(c: Check, es: readonly Node[], i: number): boolean {
  const e = es[i]!
  const flags = contentFlags(c, e)
  const suffix = mayCross(c, e, flags) ? closerOf(c.w, e, c.flags) : null
  if (suffix === null) return false
  let end = i + 1
  // A label or a bracket pair can run on over a line break (C2-I-076).
  while (end < es.length && end - i <= MAX_ACROSS) end++
  const outer = end === es.length ? outerInlines(c, end - i) : []
  const closer: Node = standIn(c.w, e, 'closer', suffix)
  const word: Node = standIn(c.w, e, 'word', 'x')
  const behind = new Set(outer.flatMap((node) => (node.type === 'text' ? [node] : textsBelow(node))))
  const inlines = [...childNodes(e), closer, ...es.slice(i + 1, end), ...outer]
  // The stand-ins for markup take no escape, and neither does a mark of the node in its content,
  // which asks for the braced form instead (C2-W-069).
  const mark = CLOSING_MARKS.get(e.type)
  const own = new Set(textsBelow(e))
  // Behind the closers around it, the stand-ins read as text, not as the closers they are, so what stands there takes none.
  // A mark of the node behind it would pair with the stand-in of its closer, and one of a paired node around it asks for
  // the braced form of that node.
  const marks = outer.length > 0 ? aroundMarks(c, mark) : ''
  const takes = (node: TextNode, at: number): boolean => node !== closer && node !== word && !behind.has(node) &&
    !(own.has(node) && node.value[at] === mark) && !marks.includes(node.value[at]!)
  // Bare, a name sigil keeps its boundary; behind a word, no block opens and a leading space stays.
  const before = c.escapes.length
  // A note's content is read behind its sigil, which the probe stands in for with a mark that opens nothing.
  const sigil = e.type === 'inline_footnote' ? standIn(c.w, e, 'sigil', ';') : null
  const found = sigil !== null
    ? probeEscapes(c, e, [sigil, ...inlines], flags, 'across', (node, at) => node !== sigil && takes(node, at)) === true
    : probeEscapes(c, e, inlines, flags, 'across', takes) === true ||
    probeEscapes(c, e, [word, ...inlines], flags, 'across', takes) === true
  if (found && outer.length > 0) reportOpeners(c, before)
  return found
}

/**
 * A span whose attribute block holds a line break forms in no spelling: the block closes the span (C2-I-040) and is all
 * on one line (C2-I-028). A table row is written on one line, which takes the break out of the block.
 */
function unformable(node: Node, flags: number): boolean {
  return node.type === 'span' && (flags & IN_CELL) === 0 && /[\r\n]/u.test(braceBlock(node))
}

/** Text of a simple span forest, with its potential openers. */
function forestText(node: TextNode, inside: boolean, escapes: Map<TextNode, number[]>): boolean {
  if (!inside || node.value !== '[ ') return false
  escapes.set(node, [0])
  return true
}

function forestWrapper(node: Node, inside: boolean): boolean {
  return node.type === 'paragraph' || (!inside && (node.type === 'emphasis' || node.type === 'strong'))
}

/** Only the span attribute block is authored by this shortcut; other fields need the loss check. */
function forestFieldsCanForm(node: Node): boolean {
  if (node.data !== undefined || node.metadata !== undefined || node.lang !== undefined || node.dir !== undefined ||
    node.pos !== undefined || node.segments !== undefined) return false
  if (node.type !== 'span' && node.attrs !== undefined) return false
  if (node.type === 'paragraph' && (node.role !== undefined || node.caption !== undefined)) return false
  if (node.type === 'span' && !forestSpanAttrsCanForm(node)) return false
  return true
}

/** A simple set of named values cannot be reframed as id, class, or language fields. */
function forestKeyCanForm(key: string): boolean {
  return isKey(key) && key === key.toLowerCase() && !['id', 'class', 'lang', 'dir'].includes(key)
}

/**
 * The block holds only keys, so it has a line break (C2-I-028) or a bracket the forest cannot write exactly where a
 * value does.
 */
function forestValueCanForm(value: string): boolean {
  return !/[\0\r[\]\uD800-\uDFFF]/u.test(value)
}

function forestSpanAttrsCanForm(node: Node): boolean {
  if (node.type !== 'span') return false
  const attrs = node.attrs
  const pairs = attrs?.keyValues
  if (attrs?.id !== undefined || attrs?.classes !== undefined || pairs === undefined || pairs.length === 0) return false
  if (pairs.length === 1) return forestKeyCanForm(pairs[0]![0]) && forestValueCanForm(pairs[0]![1])
  const seen = new Set<string>()
  for (const [key, value] of pairs) {
    if (!forestKeyCanForm(key) || !forestValueCanForm(value) || seen.has(key)) return false
    seen.add(key)
  }
  return true
}

function forestNodeCanForm(node: Node, inside: boolean, escapes: Map<TextNode, number[]>): boolean {
  if (!forestFieldsCanForm(node)) return false
  if (node.type === 'span') return true
  if (node.type === 'text') return forestText(node, inside, escapes)
  return forestWrapper(node, inside)
}

/** Every node the shortcut writes must be supported by a bracket opener in its subtree. */
function forestNodesCanForm(scanned: readonly Node[], escapes: Map<TextNode, number[]>): boolean {
  const hasOpener = new Map<Node, boolean>()
  for (let at = scanned.length - 1; at >= 0; at--) {
    const node = scanned[at]!
    const found = node.type === 'text' ? escapes.has(node) : childNodes(node).some((child) => hasOpener.get(child))
    if (node.type !== 'paragraph' && node.type !== 'text' && !found) return false
    hasOpener.set(node, found)
  }
  return true
}

/** Independent formable span branches in one paragraph share a bracket kind in the repair. */
export function simpleSpanForest(nodes: readonly Node[]): Map<TextNode, number[]> {
  const escapes = new Map<TextNode, number[]>()
  if (nodes.length !== 1 || nodes[0]?.type !== 'paragraph') return escapes
  const pending: [Node, boolean][] = [[nodes[0], false]]
  const scanned: Node[] = []
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) {
    const [node, inside] = item
    scanned.push(node)
    if (!forestNodeCanForm(node, inside, escapes)) return new Map<TextNode, number[]>()
    for (const child of childNodes(node)) pending.push([child, inside || node.type === 'span'])
  }
  return forestNodesCanForm(scanned, escapes) ? escapes : new Map<TextNode, number[]>()
}

/** Neither `e` nor a node around it can form, so no escape makes one form. */
function noneForms(c: Check, e: Node): boolean {
  return unformable(e, c.flags) && !c.formsAround && c.around.every(([list, at, flags]) => unformable(list[at]!, flags))
}

/** Whether a construct can open in the content of `e` and run on over its closer. */
function mayCross(c: Check, e: Node, flags: number): boolean {
  const type: string = e.type
  // A span is written as a link label is; a note is probed behind a stand-in for its sigil.
  if ((!isPairedMark(e) && type !== 'span' && type !== 'inline_footnote') || !('children' in e)) return false
  if (!textsBelow(e).some((text) => opensAcross(text.value))) return false
  return type !== 'link' || canCrossLinkCloser(c.w, e.children as Node[], flags)
}

/** The opener of a construct that runs on over the closers around its node is reported; any other backslash is a trial. */
function reportOpeners(c: Check, from: number): void {
  for (const escape of c.escapes.slice(from)) if (ACROSS_OPENERS.includes(escape[0].value[escape[1]]!)) c.reported.add(escape)
}

/**
 * At the end of its list, the construct runs on over the closers of the nodes around it and the inlines behind them,
 * up to `MAX_ACROSS` nodes in all.
 */
function outerInlines(c: Check, taken: number): Node[] {
  const inlines: Node[] = []
  for (let k = c.around.length - 1; k >= 0 && taken <= MAX_ACROSS; k--) {
    const [list, at, flags] = c.around[k]!
    const owner = list[at]!
    const suffix = closerOf(c.w, owner, flags)
    if (suffix === null) break
    inlines.push(standIn(c.w, owner, 'closer', closingStandIn(owner, suffix)))
    let end = at + 1
    while (end < list.length && taken <= MAX_ACROSS) {
      inlines.push(list[end++]!)
      taken++
    }
    if (end < list.length) break
  }
  return inlines
}

/** The mark `mark` and those of the paired nodes around the content under comparison. */
function aroundMarks(c: Check, mark: string | undefined): string {
  let marks = mark ?? ''
  for (const [list, at] of c.around) {
    const owner = list[at]!
    if (isPairedMark(owner) && owner.type !== 'link') marks += CLOSING_MARKS.get(owner.type) ?? ''
  }
  return marks
}

/** A closing mark of an outer node pairs with nothing in the probe, so it stands in as characters that open nothing. */
function closingStandIn(node: Node, suffix: string): string {
  return BRACKETED.has(node.type) || node.type === 'link' ? suffix : ';'.repeat(suffix.length)
}

/** The markup that closes a paired or bracketed node, as it is written: its spelling behind its content, or null. */
function closerOf(w: Writer, node: Node, flags: number): string | null {
  const type = node.type
  if ((!PAIRED_MARKS.includes(type) && !BRACKETED.has(type)) || !('children' in node)) return null
  const spelled = writeInlines(w, [node], flags)
  const content = writeInlines(w, node.children as Node[], flags | contentFlag(type))
  if (type === 'link') return spelled.slice(1 + content.length)
  if (PAIRED_MARKS.includes(type)) return spelled.slice(spelled.length - (spelled.length - content.length) / 2)
  const start = type === 'inline_footnote' ? 2 : spelled.indexOf('[') + 1
  return start > 0 && spelled.slice(start, start + content.length) === content ? spelled.slice(start + content.length) : null
}

/** The terminal link of a nested chain has no markup that can expose another label opener. */
function settledTerminal(link: LinkNode): boolean {
  if (link.children.some((child) => child.type === 'link')) return true
  const child = link.children[0]
  return link.children.length === 1 && child?.type === 'text'
}

/** Whether bare text contains another construct opener or an unclosed bracket. */
function textCanCross(w: Writer, node: TextNode, flags: number, state: { brackets: number }): boolean {
  const escaped = escapeOffsets(w, node, flags)
  let next = 0
  for (let at = 0; at < node.value.length; at++) {
    if (escaped[next] === at) {
      next++
      continue
    }
    const char = node.value[at]
    if (char === '`' || char === '<' || char === '{' || char === '$' || char === ':') return true
    if (char === '[') state.brackets++
    else if (char === ']' && state.brackets > 0) state.brackets--
  }
  return false
}

/** A link bounds its own bracket pairs only if every nested label is settled as well. */
interface CrossItem { node: Node, flags: number }

function pushCrossChildren(pending: CrossItem[], node: EmphasisNode | StrongNode, flags: number): void {
  const inside = flags | (node.type === 'strong' ? IN_STRONG : IN_EMPHASIS)
  for (let at = node.children.length - 1; at >= 0; at--) pending.push({ node: node.children[at]!, flags: inside })
}

function crossNode(w: Writer, item: CrossItem, pending: CrossItem[], state: { brackets: number }): boolean {
  const { node } = item
  if (node.type === 'link') return !settledTerminal(node) || canCrossLinkCloser(w, node.children, item.flags | IN_BRACKET)
  if (node.type === 'text') return textCanCross(w, node, item.flags, state)
  if (node.type !== 'strong' && node.type !== 'emphasis') return true
  pushCrossChildren(pending, node, item.flags)
  return false
}

function canCrossLinkCloser(w: Writer, children: readonly Node[], flags: number): boolean {
  const state = { brackets: 0 }
  const pending = children.map((node) => ({ node, flags })).reverse()
  for (let item = pending.pop(); item !== undefined; item = pending.pop()) if (crossNode(w, item, pending, state)) return true
  return state.brackets !== 0
}

// The inlines behind a node that a probe across its closing mark reads, at most.
const MAX_ACROSS = 16

/** Whether `value` holds the opener of a construct that can run on over a closing mark: a bracket, a backtick, `<`, `{`, `$` or `:`. */
const ACROSS_OPENERS = '[`<{$:'

function opensAcross(value: string): boolean {
  for (const opener of ACROSS_OPENERS) if (value.includes(opener)) return true
  return false
}

/**
 * C2-I-047, C2-I-048: whether `value` holds `mark` where its neighbors let it open or close. A mark between two word
 * characters, or between two spaces, pairs with nothing; a mark at an edge of the text is counted, as its neighbor
 * there is markup this test does not see.
 */
function holdsPairingMark(value: string, mark: string): boolean {
  for (let at = value.indexOf(mark); at >= 0; at = value.indexOf(mark, at + 1)) {
    if (at === 0 || at === value.length - 1) return true
    const before = value.codePointAt(isSecondHalf(value, at - 1) ? at - 2 : at - 1)!
    const after = value.codePointAt(at + 1)!
    if ((!isWordCharacter(before) && !isBoundarySpace(after)) || (!isBoundarySpace(before) && !isWordCharacter(after))) return true
  }
  return false
}

/** The text nodes below `node`. */
function textsBelow(node: Node): TextNode[] {
  return childNodes(node).flatMap((child) => (child.type === 'text' ? [child] : textsBelow(child)))
}

// The nodes spelled with one mark before and one after their content, or with a brace around those marks.
const PAIRED_MARKS: readonly string[] = [
  'emphasis', 'strong', 'underline', 'strike', 'highlight', 'superscript', 'subscript', 'insert', 'delete', 'link',
]

function isPairedMark(node: Node): node is Node & { children: Node[] } {
  return PAIRED_MARKS.includes(node.type) && 'children' in node
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
    if (!isBreak(node) || next?.type !== 'text' || !hasOpenerShape(nodes, at + 1) || !opensBlockAlone(c, nodes, at + 1)) continue
    if (escapeLeadingOpener(c, leadingTexts(nodes, at + 1))) return true
  }
  return false
}

/** Whether the line that starts at `nodes[from]`, written alone, opens a block: its parse is no single paragraph. */
function opensBlockAlone(c: Check, nodes: readonly Node[], from: number): boolean {
  let end = from
  while (end < nodes.length && !isBreak(nodes[end])) end++
  const line = writeInlines(c.w, nodes.slice(from, end), c.flags)
  const known = c.w.lineOpens.get(line)
  if (known !== undefined || exhausted(c.w)) return known ?? false
  const blocks = parseChunk(c.w, line).children
  const opens = blocks.length !== 1 || blocks[0]!.type !== 'paragraph'
  c.w.lineOpens.set(line, opens)
  return opens
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
function escapeOpener(c: Check, es: readonly Node[], i: number, at: number, a: Node): void {
  const e = es[i] as TextNode
  const value = e.value
  let start = at
  // C2-I-023: a line comment takes the spaces before it.
  while (start < value.length && (value[start] === ' ' || value[start] === '\t')) start++
  if (a.type === 'inline_footnote' && escapeEarlyNoteCloser(c, es, i, start)) return
  // C2-W-099: the shifted character is one of the source run, which may go on in the text nodes behind `e`.
  let holder = e
  let shifted = start + openerShift(a)
  for (let k = i + 1; shifted >= holder.value.length && es[k]?.type === 'text'; k++) {
    shifted -= holder.value.length
    holder = es[k] as TextNode
  }
  if (escapeAt(c, holder, shifted)) {
    const opener = holder.value[shifted]
    if ((opener === '[' && isChainOpener(a)) || (opener === '`' && SPAN_TYPES.includes(a.type))) c.chains.push([holder, shifted, a])
  } else if (!escapeAt(c, e, start)) c.losses.push([e, 'value'])
}

/**
 * C2-W-125, case eight: a text `^[` whose span keeps a caret pair of the tree ordinary (C2-I-089) stays bare, and the
 * bare `]` that closed it early takes the backslash. Each round reaches the next such `]` in turn.
 */
function escapeEarlyNoteCloser(c: Check, es: readonly Node[], i: number, start: number): boolean {
  const value = (es[i] as TextNode).value
  // The `[` of the opener can start the next text node of a supplied tree.
  const split = start + 1 === value.length
  const bracket = split ? es[i + 1]?.type === 'text' && (es[i + 1] as TextNode).value[0] : value[start + 1]
  if (value[start] !== '^' || bracket !== '[' || !es.slice(i + 1).some(holdsCaretPair)) return false
  if (c.notesDone.get(es[i] as TextNode)?.has(start) === true) return true
  const closer = split ? earlyNoteCloser(c, es, i + 1, 1) : earlyNoteCloser(c, es, i, start + 2)
  if (closer === null || !escapeCloserOf(c, closer)) return false
  c.earlyCloser = true
  laterNoteClosers(c, es, i, start + 2)
  return true
}

function escapeCloserOf(c: Check, [text, at]: [TextNode, number]): boolean {
  if (!escapeAt(c, text, at)) return false
  c.closers.add(c.escapes[c.escapes.length - 1]!)
  return true
}

/**
 * C2-W-088: the round escapes for every note its parse reports, also those the comparison does not reach behind a
 * node that did not form. So each later text `^[` before a caret pair takes its early closer in the same round.
 */
function laterNoteClosers(c: Check, es: readonly Node[], i: number, from: number): void {
  for (let k = i; k < es.length; k++) {
    const text = es[k]!
    if (text.type !== 'text' || !es.slice(k + 1).some(holdsCaretPair)) continue
    for (let at = text.value.indexOf('^[', k === i ? from : 0); at >= 0; at = text.value.indexOf('^[', at + 2)) {
      if (isEscaped(c, text, at) || isEscaped(c, text, at + 1)) continue
      const closer = earlyNoteCloser(c, es, k, at + 2)
      if (closer === null || !escapeCloserOf(c, closer)) continue
      const done = c.notesDone.get(text) ?? new Set<number>()
      c.notesDone.set(text, done.add(at))
    }
  }
}

/** The bare `]` of the text from `es[i]` at `from` on that no bare `[` there pairs with, or null. */
function earlyNoteCloser(c: Check, es: readonly Node[], i: number, from: number): [TextNode, number] | null {
  const open = { depth: 0 }
  // A node of the tree between, as a strong, a code span or a link, holds no bracket of the note.
  for (let k = i; k < es.length; k++) {
    const text = es[k]!
    const at = text.type === 'text' ? unpairedCloser(c, text, k === i ? from : 0, open) : -1
    if (at >= 0) return [text as TextNode, at]
  }
  return null
}

function unpairedCloser(c: Check, text: TextNode, from: number, open: { depth: number }): number {
  for (let at = from; at < text.value.length; at++) {
    const char = text.value[at]
    if ((char !== '[' && char !== ']') || isEscaped(c, text, at)) continue
    if (char === '[') open.depth++
    else if (open.depth-- === 0) return at
  }
  return -1
}

/**
 * Whether `node` or a node below it is link or span text starting with a caret, the bracket of which forms `[^`. One
 * inside an inline footnote opens nothing there (C2-I-089), so it does not count.
 */
export function holdsCaretPair(node: Node): boolean {
  return leadingCaret(node) || (node.type !== 'inline_footnote' && childNodes(node).some(holdsCaretPair))
}

/**
 * Whether the construct `a` forms from a bracket whatever lies between it and its closer: an inline
 * link, image, span or inline footnote, which a closer takes from the nearest bare bracket before it,
 * and a footnote reference, whose label any later `[^` before the closer also gives (C2-I-076,
 * C2-I-087). A reference does not: the escaped bracket changes its label, or the bracket of a full
 * reference's label starts a run the round escapes (carve#6681).
 */
function isChainOpener(a: Node): boolean {
  if (a.type === 'footnote_ref') return true
  if (a.type !== 'link' && a.type !== 'image' && a.type !== 'span' && a.type !== 'inline_footnote') return false
  return !('key' in a && a.key !== undefined)
}

/** Whether the content of `node`, its text or the alternative text of an image, holds `]`, which may close a bracket of it. */
function holdsCloser(node: Node): boolean {
  if (node.type === 'image' && node.alt?.includes(']') === true) return true
  return childNodes(node).some((child) => (child.type === 'text' ? child.value.includes(']') : holdsCloser(child)))
}

/**
 * The bracket at `at` of the text `node` opened the construct `a`, which `isChainOpener` names.
 * Once it is escaped, another bare bracket of the same run forms the same construct with the same
 * closer, so the procedure of C2-W-088 escapes the brackets of the run one per parse, and they are
 * placed in one round. A closer takes the nearest open bracket before it, so the brackets of the
 * run before it form in turn. The brackets behind it were open but past the depth limit of 200
 * where no `]` of the content closes them (C2-I-118), and they form in turn too. The label of a
 * footnote reference holds every later `[^` of the run, and it forms only from those.
 */
function escapeBrackets(c: Check, node: TextNode, at: number, a: Node): void {
  const value = node.value
  const [start, end] = bracketRun(value, at)
  // The closer stands in this text: one in a later node, such as a code span, can be taken from it by another construct.
  if (!value.includes(']', end)) return
  if (a.type === 'footnote_ref') return escapeLabels(c, node, at, end)
  // Only a bracket with the sigil of this one opens the same construct, and a bare `[^` opens no bracket pair (C2-I-087).
  // A `]` of the content pairs with a bracket the round escapes, and the freed `]` takes the next bracket (carve#6681).
  if (holdsCloser(a)) return
  const sigil = sigilOf(value, at)
  const opens = (k: number): boolean => sigilOf(value, k) === sigil && (sigil === '^' || value[k + 1] !== '^')
  for (let k = at - 1; k >= start; k--) {
    if (value[k] !== '[') continue
    if (!opens(k)) break
    escapeAt(c, node, k)
  }
  for (let k = at + 1; k < end; k++) {
    if (value[k] !== '[') continue
    if (!opens(k)) return
    escapeAt(c, node, k)
  }
}

/** The image or footnote sigil glued before the bracket at `at`, or none. */
function sigilOf(value: string, at: number): string {
  const before = value[at - 1]
  return before === '!' || before === '^' ? before : ''
}

/** The start and the end of the run of brackets around `at`, each with an image or footnote sigil at most. */
function bracketRun(value: string, at: number): [number, number] {
  const inRun = (k: number): boolean => value[k] === '[' || ((value[k] === '!' || value[k] === '^') && value[k + 1] === '[')
  let start = at
  while (start > 0 && inRun(start - 1)) start--
  let end = at + 1
  while (end < value.length && inRun(end)) end++
  return [start, end]
}

/** The `[^` behind the footnote reference at `at`, up to the run end `end`, each with more of the run behind it for a label (C2-I-079). */
function escapeLabels(c: Check, node: TextNode, at: number, end: number): void {
  const value = node.value
  for (let k = at + 1; k < end; k++) {
    if (value[k] !== '[') continue
    if (value[k + 1] !== '^' || k + 2 >= end) return
    escapeAt(c, node, k)
  }
}

// The constructs a backtick run opens, alone or behind `!` or `$` (C2-I-014, C2-I-018).
const SPAN_TYPES: readonly string[] = ['code', 'literal_inline', 'math']

interface BacktickIndex {
  offsets: Map<number, number>
  lastBare: number
}

/** C2-W-088: source offsets and the last bare backtick, read once for all chains in a comparison. */
function backtickIndex(source: string, wanted: number[]): BacktickIndex {
  const offsets = new Map<number, number>()
  const bytes = [...new Set(wanted)].sort((a, b) => a - b)
  let next = 0
  let byte = 0
  let slashes = 0
  let lastBare = -1
  for (let at = 0; at < source.length;) {
    const units = isSecondHalf(source, at + 1) ? 2 : 1
    const width = units === 2 ? 4 : unitBytes(source, at)
    while (next < bytes.length && bytes[next]! < byte + width) offsets.set(bytes[next++]!, at)
    const char = source[at]
    if (char === '`' && slashes % 2 === 0) lastBare = at
    slashes = char === '\\' ? slashes + 1 : 0
    byte += width
    at += units
  }
  while (next < bytes.length) offsets.set(bytes[next++]!, source.length)
  return { offsets, lastBare }
}

/** C2-W-088: each equal-length run before the last one becomes the next opener when the one before it is escaped. */
function escapeFollowingRuns(c: Check, node: TextNode, from: number, width: number): void {
  const value = node.value
  const starts: number[] = []
  for (let start = value.indexOf('`', from); start >= 0;) {
    let end = start + 1
    while (value[end] === '`') end++
    if (end - start !== width) return
    starts.push(start)
    start = value.indexOf('`', end)
  }
  for (let at = 0; at + 1 < starts.length; at++) escapeAt(c, node, starts[at]!)
}

/**
 * The backtick at `at` of the text `node` opened the code span `a`, which has no closing run: no
 * bare backtick stands behind its run in the written group. Escaped, the shorter run behind it
 * opens a span to the same end, which changes nothing before it, so the procedure of C2-W-088
 * escapes each backtick of the run in turn (C2-I-017). They are placed in one round.
 */
function escapeBackticks(c: Check, node: TextNode, at: number, a: Node, index: BacktickIndex | null): void {
  const source = c.source
  const value = node.value
  let run = at
  while (value[run] === '`') run++
  if (source === null) return
  if (a.pos === undefined || index === null) {
    escapeFollowingRuns(c, node, run, run - at)
    return
  }
  let start = source.indexOf('`', index.offsets.get(a.pos.startOffset) ?? source.length)
  if (start < 0) return
  const end = start + run - at
  while (start < end && source[start] === '`') start++
  if (start !== end || source[end] === '`') return
  if (index.lastBare >= end) return
  for (let k = at + 1; k < run; k++) escapeAt(c, node, k)
}

/** Extends the escapes of `chains` that this round places by the escapes the procedure would place behind each, one per parse. */
export function extendChains(c: Check): void {
  if (c.chains.length === 0) return
  const placed = new Map<TextNode, Set<number>>()
  for (const [node, at] of c.escapes) placed.set(node, (placed.get(node) ?? new Set()).add(at))
  const backticks = c.chains.filter(([node, at, a]) => placed.get(node)?.has(at) === true && node.value[at] === '`' &&
    a.pos !== undefined)
  const offsets = backticks.flatMap(([, , a]) => a.pos === undefined ? [] : [a.pos.startOffset])
  const index = c.source === null || offsets.length === 0 ? null : backtickIndex(c.source, offsets)
  for (const [node, at, a] of c.chains) {
    if (placed.get(node)?.has(at) !== true) continue
    if (node.value[at] === '`') escapeBackticks(c, node, at, a, index)
    else escapeBrackets(c, node, at, a)
  }
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

/** `escapeMark` for the closing mark of a node that ended early; the escape is kept as one of `c.closers`. */
function escapeCloser(c: Check, nodes: readonly Node[], start: number, from: number, mark: string): boolean {
  if (!escapeMark(c, nodes, start, from, mark)) return false
  c.closers.add(c.escapes[c.escapes.length - 1]!)
  return true
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
  else if (mark !== undefined && escapeCloser(c, es, i, vi, mark)) {
    c.cut = true
    if (isPaired(owner)) c.earlyClosers.push([owner, c.escapes[c.escapes.length - 1]!])
  }
  else c.losses.push([owner, null])
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
  // C2-W-016: a line that holds only a CR, and spaces, is a blank line once the line ending takes the CR.
  const line = isBreak(es[i]) ? es[i + 1] : undefined
  if (line?.type === 'text' && endsLineWithCr(line.value, 0)) {
    c.losses.push([line, 'value'])
    return
  }
  // C2-W-097: a backslash at the end of the text before took the markup of this node. A line break has no markup to take.
  if (i > 0 && !isBreak(es[i]) && escapeEnd(c, lastText(es[i - 1]), false)) return
  // C2-W-026, C2-W-092: the content ended at the start of a line, which opened a block.
  if (i > 0 && isBreak(es[i - 1])) escapeLineStart(c, es, openerLine(es, i), owner)
  else if (CLOSING_MARKS.has(owner.type)) closedEarly(c, es, i, 0, owner)
  else if (isBreak(es[i]) && i + 1 < es.length) escapeLineStart(c, es, openerLine(es, i + 1), owner)
  else c.losses.push([es[i] ?? owner, null])
}

/** C2-W-125, case six: the escape just placed is of the closing mark that starts the text `es[i]` behind a node. */
function markLengthening(c: Check, es: readonly Node[], i: number): void {
  if (i > 0 && startsWithCloser(es[i - 1]!, es[i])) {
    const escape = c.escapes[c.escapes.length - 1]!
    c.lengthening.add(escape)
    if (isPaired(es[i - 1]!)) c.pairedLengthening.add(escape)
  }
}

/** Steps over the characters that the expected text `e` and the parsed text `a` share at the cursor. False where they differ. */
function matchCharacters(c: Check, e: TextNode, a: TextNode, at: Cursor, es: readonly Node[], owner: Node): boolean {
  const value = e.value
  const other = a.value
  const length = Math.min(value.length - at.vi, other.length - at.aj)
  for (let k = 0; k < length; k++) {
    if (value.charCodeAt(at.vi + k) === other.charCodeAt(at.aj + k)) continue
    // C2-W-125: behind a content that ended early the parse holds the rest of that content as text, which opens nothing.
    if (c.cut) return false
    // C2-W-124, C2-W-091: the blanks that start a line are dropped by the parse. They are the loss of the text, and the
    // comparison goes on behind them, so that a construct there is reported in the same round.
    if (isBlank(value.charCodeAt(at.vi + k)) && atLineStart(e, es, at.i, at.vi + k, owner)) {
      c.losses.push([e, 'value'])
      at.vi += k
      at.aj += k
      while (isBlank(value.charCodeAt(at.vi))) at.vi++
      return matchCharacters(c, e, a, at, es, owner)
    }
    // The parse read a character of the text as markup, such as a backslash before punctuation (C2-W-097).
    if (!escapeAt(c, e, at.vi + k)) differingCharacter(c, e, other, at, k)
    else if (at.vi + k === 0) markLengthening(c, es, at.i)
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

/** C2-I-089: a footnote reference shape in a note reads as its source, its backslashes too, so its bracket takes one. */
function differingCharacter(c: Check, e: TextNode, other: string, at: Cursor, k: number): void {
  if (other.charCodeAt(at.aj + k) !== BACKSLASH || !escapeNoteReference(c, e, at.vi + k)) c.losses.push([e, 'value'])
}

/**
 * C2-I-089: escapes the `[` of the earliest `[^` before `to` in `node` whose label is still open at `to`: inside an
 * inline footnote that shape is text kept as written, so a backslash of the writer in it would read as a character.
 */
function escapeNoteReference(c: Check, node: TextNode, to: number): boolean {
  const value = node.value
  let open = -1
  for (let at = 0; at < to; at++) {
    const code = value.charCodeAt(at)
    if (code === BACKSLASH) at++
    else if (code === BRACKET_CLOSE) open = -1
    else if (open < 0 && code === BRACKET_OPEN && value.charCodeAt(at + 1) === CARET && !isEscaped(c, node, at)) open = at
  }
  return open >= 0 && escapeAt(c, node, open)
}

/**
 * Compares the expected text at the cursor with the parse. Returns false where the lists cannot
 * be compared further.
 */
/** The parse ended inside the text node `es[at.i]` of `owner`. */
function parseEndsInText(c: Check, es: readonly Node[], at: Cursor, owner: Node): boolean {
  // C2-W-125: the node before read on into this text; once its repair closes it in place, the text reads as written.
  if (c.cut) return false
  // C2-W-016: a CR that ends a line is read as part of the line ending, and no spelling keeps it,
  // nor the spaces before it, which then end the line.
  if (es[at.i]?.type === 'text' && endsLineWithCr((es[at.i] as TextNode).value, at.vi)) {
    c.losses.push([es[at.i]!, 'value'])
    return false
  }
  // C2-W-093: the node before took this text into its content, its mark closing the node in place of the node's own.
  if (at.vi === 0 && at.i > 0 && startsWithCloser(es[at.i - 1]!, es[at.i]) && escapeAt(c, es[at.i] as TextNode, 0)) {
    c.behind.add(c.escapes[c.escapes.length - 1]!)
    return false
  }
  // C2-W-026, C2-W-092: the content ended at the start of a line, which opened a block.
  if (at.vi === 0 && at.i > 0 && isBreak(es[at.i - 1])) escapeLineStart(c, es, openerLine(es, at.i), owner)
  else if (CLOSING_MARKS.has(owner.type)) closedEarly(c, es, at.i, at.vi, owner)
  else c.losses.push([owner, null])
  return false
}

/**
 * C2-W-069: a bare emphasis or strong whose content starts or ends with its own mark, unescaped. Glued to the opener
 * or the closer, that mark could pair, so the node takes its braced form (carve#6469).
 */
function markAtContentEdge(c: Check, owner: Node): boolean {
  if (!isPaired(owner) || !hasOtherForm(c, owner)) return false
  const mark = CLOSING_MARKS.get(owner.type)!
  const first = owner.children[0]
  if (first?.type === 'text' && first.value.startsWith(mark) && !isEscaped(c, first, 0)) return true
  const last = lastText(owner)
  return last !== null && last.value.endsWith(mark) && !isEscaped(c, last, last.value.length - 1)
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
  if (es[at.i] === undefined) readOnPastEnd(c, owner)
  else if (at.j + 1 >= as.length && isPaired(owner) && !joinsNext(es, at.i) && !holdsSpelling(c, es[at.i]!, as[at.j]!, at.aj)) {
    closedEarly(c, es, at.i, 0, owner)
  }
  else {
    c.parsed = as
    c.parsedAt = at.j
    return respell(c, es, at.i) && stepOver(c, es, as, at)
  }
  return false
}

/** The content of `owner` read on past its end: its closing mark did not close there. */
function readOnPastEnd(c: Check, owner: Node): void {
  // C2-W-069: a content mark glued to the closer could close the node, so the braced form holds it, whatever stands
  // behind the node (carve#6469).
  if (markAtContentEdge(c, owner)) {
    changeForm(c, owner)
    return
  }
  // C2-W-125: repair a bracketed owner's content pairing first. Otherwise a brace before the closing mark can
  // read as a braced opener and takes the mark before case five tries the closer. Read the content again next round.
  if (BRACKETED.has(owner.type) && escapeInContent(c, owner)) {
    c.cut = true
    return
  }
  if (escapeOpeningBrace(c, owner)) {
    c.readOn.add(c.escapes[c.escapes.length - 1]!)
    c.cut = true
    return
  }
  if (escapeInContent(c, owner) || escapeEnd(c, lastText(owner), true)) {
    c.cut = true
    return
  }
  // C2-W-069: a closing mark that cannot close where it stands, as behind a space, closes in the braced form.
  if (isPaired(owner) && hasOtherForm(c, owner)) changeForm(c, owner)
  else c.losses.push([owner, null])
}

/** C2-W-125, case one: the last brace of the content of `owner` that reads as a braced opener, with its mark behind it. */
function escapeOpeningBrace(c: Check, owner: Node): boolean {
  const text = lastText(owner)
  if (text === null) return false
  const value = text.value
  const closer = CLOSING_MARKS.get(owner.type) ?? ''
  for (let at = value.lastIndexOf('{'); at >= 0; at = value.lastIndexOf('{', at - 1)) {
    const next = at + 1 < value.length ? value[at + 1]! : closer
    if (next !== '' && BRACED_MARKS.includes(next) && !isEscaped(c, text, at)) return escapeAt(c, text, at)
    if (at === 0) break
  }
  return false
}

/** Whether the text `a` holds the spelling of `e` from `offset` on: `e` did not form, and the content around it did not end there. */
function holdsSpelling(c: Check, e: Node, a: Node, offset: number): boolean {
  if (a.type !== 'text') return false
  const spelled = writeInlines(c.w, [e], c.flags).replace(/\\([\s\S])/g, '$1')
  return a.value.startsWith(spelled, offset)
}

function matchText(c: Check, e: TextNode, es: readonly Node[], as: readonly Node[], at: Cursor, owner: Node): boolean {
  const value = e.value
  const a = as[at.j]
  if (a === undefined) return parseEndsInText(c, es, at, owner)
  if (a.type !== 'text') return skipConstruct(c, e, es, a, at, owner)
  if (!matchCharacters(c, e, a, at, es, owner)) return false
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

function isBlank(value: number): boolean {
  return value === 32 || value === 9
}

/** Whether the offset `at` of `e`, the node `es[i]` of `owner`, starts a line of the written content. */
function atLineStart(e: TextNode, es: readonly Node[], i: number, at: number, owner: Node): boolean {
  if (at > 0) return e.value[at - 1] === '\n'
  return i > 0 ? isBreak(es[i - 1]) : owner.type === 'paragraph'
}

/**
 * Where the construct `a` starts in `e`: past the blanks that start a line, which the parse drops (a lost value,
 * C2-W-124), except for a comment, whose source holds them (C2-I-023).
 */
function constructStart(e: TextNode, es: readonly Node[], at: Cursor, a: Node, owner: Node): number {
  const value = e.value
  if (a.type === 'comment' || !atLineStart(e, es, at.i, at.vi, owner)) return at.vi
  let start = at.vi
  while (isBlank(value.charCodeAt(start))) start++
  return start
}

/**
 * C2-I-118: in a group past the depth cap, a bracket construct the parse read over text of the tree opens on the last
 * bracket the reader pushed, and the bare brackets of the text behind it are text only because the stack was full.
 * Its escape frees one entry, so the next round reads the same construct on the next bracket. Records the opener
 * and the end of the construct in the text for `escapeCappedRun`.
 */
function recordCappedRun(c: Check, e: TextNode, from: number, end: number, shift: number): void {
  if (c.w.planWhy !== 'depth cap') return
  const value = e.value
  const stop = end < 0 ? value.length : end
  let at = from
  while (at < stop && (value[at] === ' ' || value[at] === '\t')) at++
  at += shift
  if (value[at] === '[' && c.marks.get(e)?.get(at) === true) c.capped.push([e, at, stop])
}

/**
 * C2-I-118: where the escape of one capped opener is all a round asks, the rounds after it would escape each bare
 * bracket behind it in turn, one per round. Those escapes are placed in this round; `trimCappedRuns` keeps as many
 * of them as the rounds would have placed.
 */
export function escapeCappedRun(c: Check): void {
  const capped = c.capped[0]
  c.capped.length = 0
  if (capped === undefined || c.escapes.length !== 1 || c.retracted.length + c.forms.length > 0) return
  const [e, opener, stop] = capped
  if (c.escapes[0]![0] !== e || c.escapes[0]![1] !== opener) return
  const value = e.value
  for (let at = value.indexOf('[', opener + 1); at >= 0 && at < stop; at = value.indexOf('[', at + 1)) {
    if (escapeAt(c, e, at)) c.w.cappedRuns.push([e, at])
  }
}

/** C2-I-089: a caret pair that a probe of note content reads, where the note's parse in its context holds none. */
function inNoteOnly(c: Check, a: Node): boolean {
  return c.note !== null && (a.type === 'footnote_ref' || a.type === 'inline_footnote')
}

const BRACKET_CONSTRUCTS: ReadonlySet<string> = new Set(['footnote_ref', 'inline_footnote', 'link', 'span', 'image', 'inline_extension'])

/**
 * Whether the parse in its context reads a bracket construct where the note `e` is written: in
 * the nodes from the place of `e` on whose start lies within twice the length of its text and its sigil, which bounds
 * its written form with every character escaped.
 */
function readsBracketConstruct(c: Check, e: Node): boolean {
  const list = c.parsed
  const first = list[c.parsedAt]
  if (first === undefined) return false
  const stop = (first.pos?.startOffset ?? 0) + bracketWindow(e)
  for (let at = c.parsedAt; at < list.length; at++) {
    const node = list[at]!
    if (at > c.parsedAt && (node.pos === undefined || node.pos.startOffset >= stop)) break
    if (holdsBracketConstruct(node)) return true
  }
  return false
}

/** Twice the length of the text of `e` and its sigil, which bounds its written form with every character escaped. */
function bracketWindow(e: Node): number {
  return 2 * (textsBelow(e).reduce((total, text) => total + utf8Length(text.value), 0) + 3)
}

function holdsBracketConstruct(node: Node): boolean {
  const pending = [node]
  for (let below = pending.pop(); below !== undefined; below = pending.pop()) {
    if (BRACKET_CONSTRUCTS.has(below.type)) return true
    pushAll(pending, childNodes(below))
  }
  return false
}

/**
 * As `readsBracketConstruct` for `es[i]`, with the window behind the text the parse read in its place, which can hold
 * text before it. The siblings the tree holds behind it, matched in order, are no construct.
 */
function readsOtherBracketConstruct(c: Check, es: readonly Node[], i: number): boolean {
  const list = c.parsed
  const first = list[c.parsedAt]
  if (first === undefined) return false
  const stop = (first.pos?.endOffset ?? 0) + bracketWindow(es[i]!)
  let next = i + 1
  for (let at = c.parsedAt; at < list.length; at++) {
    const node = list[at]!
    if (at > c.parsedAt && (node.pos === undefined || node.pos.startOffset >= stop)) break
    // Text of the tree can join the text around it in the parse, so only the other siblings are matched.
    while (es[next]?.type === 'text') next++
    if (next < es.length && treesEqual(es[next]!, node)) next++
    else if (holdsBracketConstruct(node)) return true
  }
  return false
}

/** Whether the bare brackets of `e` in `[from, to)` close each other as ordinary brackets. */
function bracketsBalance(c: Check, e: TextNode, from: number, to: number): boolean {
  let depth = 0
  for (let at = from; at < to; at++) {
    const char = e.value[at]
    if ((char !== '[' && char !== ']') || isEscaped(c, e, at)) continue
    depth += char === '[' ? 1 : -1
    if (depth < 0) return false
  }
  return depth === 0
}

/** The escapes `escapes` of a construct's opener: a case-five repair in a note, else an opener, and a read-on brace. */
function keepOpenerEscapes(c: Check, escapes: readonly [TextNode, number][], caret: boolean, owner: Node): void {
  for (const escape of escapes) {
    (caret ? c.closers : c.constructs).add(escape)
    if (!caret && readsIntoCloser(owner, escape)) c.readOn.add(escape)
  }
}

/**
 * C2-W-125, case one, C2-W-088: the brace that ends the content of `owner` reads with the closing mark of `owner` as a
 * braced opener, so `owner` reads on. That is a repair of the tree's own node and gives no kind; like an opener, it
 * goes before the repairs beside it.
 */
function readsIntoCloser(owner: Node, [text, at]: [TextNode, number]): boolean {
  return text.value[at] === '{' && at === text.value.length - 1 && lastText(owner) === text &&
    !BRACKETED.has(owner.type) && CLOSING_MARKS.has(owner.type)
}

/** The parse read a construct where the tree has text: escapes its opener and steps over it (C2-W-091). */
function skipConstruct(c: Check, e: TextNode, es: readonly Node[], a: Node, at: Cursor, owner: Node): boolean {
  // C2-W-125: behind a content that ended early, the parse can open a construct on the markup of the tree.
  if (c.cut) return false
  const quoted = comparisonBehindQuote(es[at.i - 2], es[at.i - 1], e, at.vi, a)
  const pos = a.pos
  const end = pos === undefined ? -1 : spelledEnd(c.w, e, constructStart(e, es, at, a, owner), pos.endOffset - pos.startOffset, c.flags)
  const caret = inNoteOnly(c, a)
  const before = c.escapes.length
  // C2-I-089: a probe reads the content of a note out of it, where a caret pair opens a construct. In the note it opens
  // nothing and its brackets are ordinary: a pair of them stays bare, and a lone one takes a backslash of C2-W-125,
  // case five, which gives no kind (C2-W-088).
  if (caret && end >= 0 && bracketsBalance(c, e, at.vi, end)) {
    // nothing to escape
  } else if (quoted) escapeAt(c, e, at.vi + 1)
  else escapeOpener(c, es, at.i, at.vi, a)
  keepOpenerEscapes(c, c.escapes.slice(before), caret, owner)
  if (pos === undefined) return false
  if (!quoted) recordCappedRun(c, e, at.vi, end, openerShift(a))
  if (end < 0) {
    escapeInnerQuotes(c, es, at.i, at.vi, a)
    return false
  }
  at.vi = end
  at.j++
  if (at.vi === e.value.length) {
    at.i++
    at.vi = 0
  }
  return true
}

/** Report quote neighbors in a construct's span after its opener escape, except delimiters that cannot open. */
function escapeInnerQuotes(c: Check, es: readonly Node[], i: number, from: number, a: Node): void {
  const pos = a.pos!
  const quotes = new Map<number, string>()
  const pending = [...childNodes(a)]
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === 'smart_punctuation' && node.pos !== undefined) quotes.set(node.pos.startOffset, node.kind)
    pushAll(pending, childNodes(node))
  }
  if (quotes.size === 0) return
  const e = es[i] as TextNode
  const escapes = c.w.escapes.get(e) ?? []
  let offset = pos.startOffset + utf8Length(writeInline(c.w, e, c.flags)) - utf8Length(e.value.slice(0, from)) -
    escapes.filter((at) => at < from).length
  for (let k = i + 1; k < es.length && offset < pos.endOffset; k++) {
    const node = es[k]!
    const kind = quotes.get(offset)
    const next = textAt(es, k + 1)
    if (node.type === 'smart_punctuation' && kind !== undefined && kind !== node.kind && next !== null &&
      !terminalDelimiter(next, es, k + 1) && !readsBackAsText(node.source, node.kind, es[k - 1], next)) escapeSmartNeighbor(c, next, false)
    offset += utf8Length(writeInline(c.w, node, c.flags))
  }
}

/**
 * C2-W-125, case two: where the text before a quote gives its kind once the construct is escaped, the right neighbor
 * decides nothing and keeps no backslash; the next round reads the quote again.
 */
function readsBackAsText(source: string, kind: string, prior: Node | undefined, next: TextNode): boolean {
  if (prior?.type !== 'text' || (source !== '"' && source !== "'")) return false
  const previous = prior.value.codePointAt(prior.value.length - 1)
  const following = next.value.codePointAt(0)
  if (previous === undefined || following === undefined || (previous >= 0xdc00 && previous < 0xe000)) return false
  return textQuoteKind(source, previous, following) === kind
}

/** C2-I-047: a slash or star with no following character cannot open a paired span. */
function terminalDelimiter(next: TextNode, es: readonly Node[], index: number): boolean {
  return (next.value === '/' || next.value === '*') && index === es.length - 1
}

/** C2-W-125, case seven: escaping a comparison's first character would turn the preceding right quote left. */
function comparisonBehindQuote(prior: Node | undefined, before: Node | undefined,
  text: TextNode, at: number, parsed: Node): boolean {
  const neighbor = prior?.type === 'text' ? prior.value.at(-1) : undefined
  return before?.type === 'smart_punctuation' &&
    (before.kind === 'right_single_quote' || before.kind === 'right_double_quote') &&
    (neighbor === '/' || neighbor === '-') &&
    parsed.type === 'smart_punctuation' &&
    (parsed.kind === 'not_equal' || parsed.kind === 'less_than_or_equal' || parsed.kind === 'greater_than_or_equal') &&
    '!<>'.includes(text.value[at] ?? '') && text.value[at + 1] === '='
}

/**
 * Whether the parse read `es[i]` differently because of the text beside it, which then takes a
 * backslash. C2-I-036: a brace block in the text behind a host was read as its attributes.
 * C2-I-105: the side a quote opens to, and the length of a dash, follow from the characters around.
 */
function readsNeighbor(c: Check, e: Node, es: readonly Node[], i: number, a: Node): boolean {
  const next = textAt(es, i + 1)
  if (next !== null && a.attrs !== undefined && !sameValue(e.attrs, a.attrs) && next.value.startsWith('{')) return escapeAt(c, next, 0)
  // C2-I-015: a backtick behind a closing run makes it longer, so the span reads on into the text behind it.
  // C2-I-090: a name character behind a mention or a tag makes the name longer.
  if (next !== null && readsOn(e, next) && differingField(c, e, a) !== null) {
    if (!escapeAt(c, next, 0)) return false
    c.lengthening.add(c.escapes[c.escapes.length - 1]!)
    return true
  }
  if (e.type !== 'smart_punctuation' || a.type !== 'smart_punctuation' || (e.kind === a.kind && e.source === a.source)) return false
  return escapeSmartSideAfterConstruct(c, es, i, next)
}

/** A text quote whose own opener is being escaped can restore the following smart quote on the next parse. */
function escapeSmartSideAfterConstruct(c: Check, es: readonly Node[], i: number, next: TextNode | null): boolean {
  const before = c.escapes.length
  const changed = escapeSmartSide(c, textAt(es, i - 1), next)
  const prior = textAt(es, i - 1)
  if (prior !== null && (prior.value.endsWith('"') || prior.value.endsWith("'")) &&
    [...c.constructs].some(([node, at]) => node === prior && at === prior.value.length - 1)) {
    for (const escape of c.escapes.slice(before)) c.behind.add(escape)
  }
  return changed
}

/** C2-I-105: the smart punctuation between `before` and `next` read as another kind; a neighbor takes the backslash. */
function escapeSmartSide(c: Check, before: TextNode | null, next: TextNode | null): boolean {
  const leftChanges = isPending(c, before ?? undefined)
  if (next !== null && escapeSmartNeighbor(c, next, leftChanges)) return true
  // Where the text before it changes in this round, the next round reads its direction again.
  return before !== null && !leftChanges && escapeAt(c, before, before.value.length - 1)
}

/**
 * The neighbor of a quote that read in another direction takes the backslash. `leftChanges` says the text before the
 * quote takes an escape in this round, so the escape of a sigil opener behind it would not turn the quote: C2-W-125,
 * case seven, puts the backslash before the bracket of that opener.
 */
function escapeSmartNeighbor(c: Check, next: TextNode, leftChanges: boolean): boolean {
  if (moveSigilEscape(c, next)) return true
  const bracket = leftChanges ? sigilBracket(c, next) : -1
  return (bracket > 0 && escapeAt(c, next, bracket)) || escapeComparison(c, next) || escapeAt(c, next, 0)
}

/** The bracket of the sigil opener `:name[` at the start of `next` while it is bare, or -1. */
function sigilBracket(c: Check, next: TextNode): number {
  const value = next.value
  if (value[0] !== ':') return -1
  let bracket = 1
  while (bracket < value.length && isExtensionNameChar(value.charCodeAt(bracket))) bracket++
  return bracket === 1 || value[bracket] !== '[' || isEscaped(c, next, bracket) ? -1 : bracket
}

/** C2-W-125, case seven: the second character of a comparison sign can take the escape without flipping a quote. */
function escapeComparison(c: Check, next: TextNode): boolean {
  const value = next.value
  if (value.length < 2 || !'!<>'.includes(value[0]!) || value[1] !== '=') return false
  return escapeAt(c, next, 1)
}

/**
 * C2-W-125, case seven: the escape of the sigil opener `:name[` at the start of `next` changed the
 * direction of the quote before it, so the backslash goes before the bracket of that opener.
 */
function moveSigilEscape(c: Check, next: TextNode): boolean {
  if (!isEscaped(c, next, 0)) return false
  const bracket = sigilBracket(c, next)
  if (bracket < 0) return false
  c.retracted.push([next, 0])
  mark(c, next, 0, false)
  return escapeAt(c, next, bracket)
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
  if (a.type !== e.type || at.aj > 0) {
    // C2-W-125: behind a content that ended early the parse reads its neighbors otherwise, which no respelling repairs.
    if (c.cut) return false
    c.parsed = as
    c.parsedAt = at.j
    if (respell(c, es, at.i)) return stepOver(c, es, as, at)
    return stepOverLost(c, e, es, as, at)
  }
  if (isLostCode(c, es[at.i + 1])) {
    // C2-W-112: the code spans behind this one were written into it and reported.
    at.i++
    while (isLostCode(c, es[at.i])) at.i++
    at.j++
    return true
  }
  if (readsNeighbor(c, e, es, at.i, a)) return false
  repairCommentCloser(c, es, at.i, e, a)
  const outer = c.cut
  const asked = changes(c)
  c.cut = false
  c.around.push([es, at.i, c.flags])
  compareInline(c, e, a)
  c.around.pop()
  // C2-W-125: a content that read on or ended early was repaired inside; behind it the parse is read again next round.
  if (changes(c) > asked && BRACKETED.has(e.type) && extentDiffers(c, e, a)) c.cut = true
  c.cut ||= outer
  at.i++
  at.j++
  return VERBATIM.has(e.type) && differingField(c, e, a) !== null ? stepOverAbsorbed(c, e, es, as, a, at) : true
}

/** Whether the parse node `a` spans other bytes than the spelling of `e` it was read from, on one line. */
function extentDiffers(c: Check, e: Node, a: Node): boolean {
  const pos = a.pos
  const own = writeInlines(c.w, [e], c.flags)
  return pos !== undefined && !own.includes('\n') && pos.endOffset - pos.startOffset !== utf8Length(own)
}

const VERBATIM: ReadonlySet<string> = new Set(['code', 'literal_inline', 'math', 'raw_inline'])

/**
 * C2-W-117, C2-W-124: the span `a` read on past the spelling of `e` to a later closing run. Every sibling whose
 * spelling starts before that closer is part of `a` and is lost. What the last one leaves behind the closer is read
 * on: where it opens another span, that span takes the siblings that start before its own end, by the same rule.
 */
function stepOverAbsorbed(c: Check, e: Node, es: readonly Node[], as: readonly Node[], a: Node, at: Cursor): boolean {
  let end = a.pos?.endOffset
  if (end === undefined) return true
  const own = writeInlines(c.w, [e], c.flags)
  // Container prefixes on later lines would stand between the offsets.
  if (own.includes('\n')) return true
  return loseInto(c, es, as, at, { offset: a.pos!.startOffset + utf8Length(own), start: 0, spelled: '' }, end)
}

/**
 * C2-W-117, C2-W-124: the verbatim node `e` read back as no node of its kind, and a span of the parse that starts
 * inside its spelling reads on past it. That span takes the siblings that start before its end, as above.
 */
function stepOverLost(c: Check, e: Node, es: readonly Node[], as: readonly Node[], at: Cursor): boolean {
  if (!VERBATIM.has(e.type) || at.anchor !== at.i) return false
  const own = writeInlines(c.w, [e], c.flags)
  if (own.includes('\n')) return false
  // The anchor is where a parse node starts, which a sibling read on before it may have moved off `e`.
  if (!spelledAt(c, at.anchorByte, own)) return false
  const offset = at.anchorByte + utf8Length(own)
  let j = at.j
  while ((as[j]?.pos?.endOffset ?? Infinity) <= offset) j++
  const reader = as[j]
  const from = reader?.pos?.startOffset ?? offset
  // A span that starts where `e` starts is `e` read with another closer (C2-W-112), not a span inside it.
  if (from <= at.anchorByte || from >= offset || !VERBATIM.has(reader!.type)) return false
  at.i++
  at.j = j + 1
  at.aj = 0
  return loseInto(c, es, as, at, { offset, start: 0, spelled: '' }, reader!.pos!.endOffset)
}

/** Whether the written group holds `spelled` at the byte `offset`. */
function spelledAt(c: Check, offset: number, spelled: string): boolean {
  if (c.source === null) return false
  const bytes = c.bytes ??= ENCODER.encode(c.source)
  const want = ENCODER.encode(spelled)
  if (offset + want.length > bytes.length) return false
  for (let k = 0; k < want.length; k++) if (bytes[offset + k] !== want[k]) return false
  return true
}

const ENCODER = new TextEncoder()

function loseInto(c: Check, es: readonly Node[], as: readonly Node[], at: Cursor, taken: Taken, end: number): boolean {
  for (;;) {
    loseBefore(c, es, at, taken, end)
    if (taken.offset < end) return false
    const next = leftoverNode(as, at, taken.offset)
    if (next === null) return true
    if (next.type === 'text') return stepIntoLeftover(at, next as TextNode, leftover(taken, next.pos!.startOffset), taken.offset)
    end = next.pos!.endOffset
    at.j++
  }
}

/** The parse node that starts inside the leftover of the last lost node and runs on past it, or null. */
function leftoverNode(as: readonly Node[], at: Cursor, offset: number): Node | null {
  // The parse nodes that lie inside the leftover belong to the lost node.
  while ((as[at.j]?.pos?.endOffset ?? Infinity) <= offset) at.j++
  const from = as[at.j]?.pos?.startOffset
  return from !== undefined && from < offset ? as[at.j]! : null
}

/** The spelling of the last lost node from the byte `from` on. */
function leftover(taken: Taken, from: number): string {
  return taken.spelled.slice(stringOffsetOfByte(taken.spelled, from - taken.start))
}

/** Where the siblings taken so far end, and the spelling and start of the last of them. */
interface Taken {
  offset: number
  start: number
  spelled: string
}

/** Loses the siblings from the cursor on whose spelling starts before `end`. */
function loseBefore(c: Check, es: readonly Node[], at: Cursor, taken: Taken, end: number): void {
  while (taken.offset < end && at.i < es.length && !isBreak(es[at.i])) {
    const to = gluedEnd(es, at.i)
    taken.spelled = writeInlines(c.w, es.slice(at.i, to), c.flags)
    taken.start = taken.offset
    taken.offset += utf8Length(taken.spelled)
    loseTaken(c, es, at, to)
  }
}

/** C2-W-112: the end of the part that starts at `from`, where code spans glued to each other are written as one. */
function gluedEnd(es: readonly Node[], from: number): number {
  let to = from + 1
  while (joinsNextCode(es, to - 1)) to++
  return to
}

function loseTaken(c: Check, es: readonly Node[], at: Cursor, to: number): void {
  for (; at.i < to; at.i++) c.losses.push([es[at.i]!, es[at.i]!.type === 'text' ? 'value' : null])
}

/** The parsed text `text` starts with `tail`, the end of a lost node; the comparison goes on behind it. */
function stepIntoLeftover(at: Cursor, text: TextNode, tail: string, offset: number): boolean {
  if (!text.value.startsWith(tail)) return false
  // The next sibling starts where the lost one ends, inside the parsed text.
  at.anchor = at.i
  at.anchorByte = offset
  at.aj = tail.length
  if (at.aj === text.value.length) {
    at.j++
    at.aj = 0
  }
  return true
}

function repairCommentCloser(c: Check, es: readonly Node[], at: number, expected: Node, actual: Node): void {
  if (expected.type !== 'comment' || actual.type !== 'comment' || expected.form !== 'line') return
  if (!expected.value.includes(']') && actual.value.includes(']')) {
    if (!repairBracketBeforeComment(c, es, at)) repairBraceBeforeComment(c, es, at)
    return
  }
  if (!expected.value.includes(']') || actual.value.includes(']')) return
  const before = es[at - 1]
  if (before?.type !== 'text') return
  for (const bracket of bracketsBeforeComment(before.value)) if (escapeAt(c, before, bracket)) return
}

/** The adjacent open braces remain text when the final bracket or caret keeps the comment inside its bracket. */
function repairBracketBeforeComment(c: Check, es: readonly Node[], at: number): boolean {
  const before = es[at - 1]
  if (before?.type !== 'text' || !before.value.includes('[{*{*')) return false
  if (before.value.slice(before.value.lastIndexOf('[')).includes('{*')) return false
  const last = before.value.length - 1
  return (before.value[last] === ']' || before.value[last] === '^') && escapeAt(c, before, last)
}

function bracketsBeforeComment(value: string): number[] {
  const open: number[] = []
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '[') open.push(index)
    else if (value[index] === ']' && open.length > 0) open.pop()
  }
  return open
}

function repairBraceBeforeComment(c: Check, es: readonly Node[], at: number): void {
  for (let index = at - 1; index >= 0; index--) {
    const node = es[index]
    if (node?.type === 'soft_break' || node?.type === 'hard_break') return
    if (node?.type !== 'text') continue
    for (let brace = node.value.length - 2; brace >= 0; brace--) {
      if (node.value[brace] === '{' && '*/-='.includes(node.value[brace + 1]!) && escapeAt(c, node, brace)) return
    }
  }
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
    // The node alone, not as a list of one: a list places escapes for its end, which would land in the real writer.
    const own = writeInline(c.w, es[k]!, c.flags)
    // Container prefixes on later lines would stand between the offsets.
    if (own.includes('\n') && !spelledAt(c, offset, own)) return false
    offset += utf8Length(own)
  }
  return false
}

/**
 * A leading space or tab of supplied text can be lost at a paragraph start while the rest of the
 * text joins the next node in the read-back parse. Continue at the surviving suffix so later
 * constructs and fields are still compared (C2-W-117).
 */
function hasAuthoredTextFields(node: TextNode): boolean {
  return node.lang !== undefined || node.dir !== undefined || node.metadata !== undefined ||
    node.attrs !== undefined || node.data !== undefined
}

function stepOverLostText(c: Check, es: readonly Node[], as: readonly Node[], at: Cursor): boolean {
  const expected = es[at.i]
  const actual = as[at.j]
  if (expected?.type !== 'text' || actual?.type !== 'text' || at.vi !== 0) return false
  const kept = expected.value.replace(/^[ \t]+/, '')
  if (kept.length === expected.value.length || !actual.value.startsWith(kept, at.aj)) return false
  if (hasAuthoredTextFields(expected)) {
    const last = c.losses.length - 1
    if (c.losses[last]?.[0] === expected) c.losses[last] = [expected, '']
  }
  at.i++
  at.aj += kept.length
  if (at.aj === actual.value.length) {
    at.j++
    at.aj = 0
  }
  return true
}

/** A failed construct on one line cannot hide constructs on following lines of the same paragraph. */
function nextBreak(nodes: readonly Node[], from: number): number {
  for (let at = from; at < nodes.length; at++) if (isBreak(nodes[at])) return at
  return nodes.length
}

/** The line ends in the spelling of `es` before `es[end]`. */
function writtenBreaks(c: Check, es: readonly Node[], end: number): number {
  let breaks = 0
  for (let k = 0; k < end; k++) {
    const spelled = writeInline(c.w, es[k]!, c.flags)
    for (let at = spelled.indexOf('\n'); at >= 0; at = spelled.indexOf('\n', at + 1)) breaks++
  }
  return breaks
}

function resyncNextConstructLine(c: Check, es: readonly Node[], as: readonly Node[], at: Cursor): boolean {
  if (es[at.i]?.type === 'text') return false
  const i = nextBreak(es, at.i + 1)
  const j = nextBreak(as, at.j)
  if (i === es.length || j === as.length || es[i]?.type !== as[j]?.type) return false
  const first = as[0]?.pos
  const actual = as[j]?.pos
  // The line is read from the written spelling: the positions of the tree are those of its source, which may differ.
  if (first === undefined || actual === undefined || actual.startLine - first.startLine !== writtenBreaks(c, es, i)) return false
  if (changes(c) === 0) for (let k = at.i; k < i; k++) c.losses.push([es[k]!, null])
  return resumeAt(at, i + 1, j + 1)
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
    if (!more && !resync(c, es, as, at) && !stepOverLostText(c, es, as, at) &&
      !resyncNextConstructLine(c, es, as, at)) return
    // C2-W-125: behind a content that ended early a text difference asks for nothing in this list, even where the
    // lists align again; the procedure runs again from the backslash that round placed.
  }
  if (at.j >= as.length) return
  // C2-W-005, C2-W-069: the content read on past its end, as its closer paired later, so the node takes the braced form
  // in every round, the kind rounds included (carve#6482).
  if (isPaired(owner) && hasOtherForm(c, owner)) changeForm(c, owner)
  else if (!escapeUnclosedBrackets(c, owner)) c.losses.push([owner, null])
}

/** A C2-W-125 bracket repair: its backslash gives no kind (C2-W-088), as that of a closer. */
function escapeBracket(c: Check, text: TextNode, at: number): boolean {
  if (!escapeAt(c, text, at)) return false
  c.closers.add(c.escapes[c.escapes.length - 1]!)
  return true
}

/**
 * C2-W-125, case five: a bare `[` of the content of a bracketed node that no bare `]` of that content closes pairs
 * with the closer of the node, so the node reads on past its end. Each such `[` takes the backslash.
 */
function escapeUnclosedBrackets(c: Check, owner: Node): boolean {
  if (!BRACKETED.has(owner.type)) return false
  const open: [TextNode, number][] = []
  contentClosers(childNodes(owner), (node, offset) => !isEscaped(c, node, offset), null, open)
  let asked = false
  for (const [text, at] of open) asked = escapeBracket(c, text, at) || asked
  // What the node took from behind its end is read again once it closes in place, so nothing behind it asks this round.
  if (asked) c.cut = true
  return asked
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
  if (sourceCoreEquivalent(e, a)) return
  if ('key' in e && e.key !== undefined && hasOtherForm(c, e)) return compareRaw(c, e, a)
  compareFields(c, e, a)
  if (!('children' in e)) return
  const outer = c.flags
  c.flags |= contentFlag(e.type)
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
  // C2-W-016: a paragraph whose line holds only a CR, and spaces, is a blank line once the line ending takes the CR.
  const first = e.type === 'paragraph' ? e.children[0] : undefined
  if (first?.type === 'text' && endsLineWithCr(first.value, 0)) {
    c.losses.push([first, 'value'])
    return
  }
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

/**
 * Compares one block with its parse. Returns false where the blocks behind it cannot be compared. `absorbed`: a lost
 * block written after `e` reads as its last block, so the parse of `e` may end in more blocks than `e` has.
 */
function compareBlock(c: Check, e: Node, a: Node, absorbed = false): boolean {
  if (c.w.lost.has(e)) return true
  if (sourceCoreEquivalent(e, a)) return true
  if (e.type !== a.type) {
    // A line-block line can be read as a comment fence instead of as text.
    // Its text opener, rather than the line node, takes the repair escape.
    if (e.type === 'line' && a.type === 'comment') escapeLineStart(c, childNodes(e), 0, e)
    else blockMismatch(c, e)
    return false
  }
  const marks = c.spanMarks
  const flags = c.flags
  if (e.type === 'table' && a.type === 'table') c.spanMarks = hasSpanMarks(e) || hasSpanMarks(a)
  if (e.type === 'table_cell') c.flags |= IN_CELL
  compareFields(c, e, a)
  // A content that ended early in another block keeps nothing of this one from being compared.
  c.cut = false
  if (isInlineParent(e)) compareInlines(c, e.children, childNodes(a), e)
  // C2-N-081: the children of an include are a result of its expansion, which the source does not hold.
  else if (e.type !== 'include') compareBlocks(c, childNodes(e), childNodes(a), e, absorbed)
  compareSlots(c, e, a)
  c.spanMarks = marks
  c.flags = flags
  return true
}

/** The blocks of a parse, by the line they start on: paragraphs by place, other blocks by column. */
interface Starts {
  paragraphs: Set<number>
  columns: Map<number, Set<number>>
  /** For the line a paragraph starts on, the line its container starts on, or -1 for the document. */
  containers: Map<number, number>
}

/** Records the start of `block`, in a container that starts on the line `container`. */
function readStart(block: Node, offset: number, container: number, starts: Starts): void {
  const pos = block.pos
  if (pos === undefined) return
  const line = pos.startLine - offset
  if (block.type === 'paragraph') {
    starts.containers.set(line, container)
    starts.paragraphs.add(line * PLACE_COLUMNS + pos.startColumn - 1)
    return
  }
  const columns = starts.columns.get(line) ?? new Set<number>()
  columns.add(pos.startColumn - 1)
  starts.columns.set(line, columns)
}

/** The starts of the blocks below the parse `node`. */
function readStarts(node: Node, offset: number, starts: Starts): void {
  const container = node.pos === undefined ? -1 : node.pos.startLine - offset
  for (const block of childNodes(node)) {
    // C2-W-088: a row has the line kind `|`; its cells open nothing at the start of a line.
    if (block.type === 'table_cell') continue
    readStart(block, offset, container, starts)
    if (!isInlineParent(block)) readStarts(block, offset, starts)
    const caption = captionOf(block)
    if (caption !== undefined) readStarts(caption, offset, starts)
  }
}

/** Whether the text at the start of a line has the shape of a block opener: punctuation, or a marker of digits or letters. */
function hasOpenerShape(nodes: readonly Node[], from: number): boolean {
  const node = nodes[from]
  const value = joinedValue(leadingTexts(nodes, from))
  if (value === '') return node !== undefined && node.type !== 'text'
  // A pipe needs another pipe to close a row (C2-B-166); one pipe opens no block.
  if (value[0] === '|' && value.indexOf('|', 1) < 0) return false
  return !isAsciiAlphanumeric(value.charCodeAt(0)) || openerOffsets(value).length > 1
}

/**
 * C2-W-090, C2-W-099: the character that takes the backslash of a block that starts at `at`: the delimiter of an
 * ordered marker, the second hyphen of a hyphen run, else the first character.
 */
function nestedOpener(value: string, at: number): number {
  if (value.startsWith('--', at)) return at + 1
  let end = at
  while (end < value.length && isAsciiAlphanumeric(value.charCodeAt(end))) end++
  return end
}

/** Whether the escapes of this round already touch `node`. */
function isPending(c: Check, node: Node | undefined): boolean {
  return node?.type === 'text' && c.marks.has(node)
}

/**
 * Escapes the opener of each line of the paragraph `e`, written at `place`, at which the parse has a
 * block. A line can start inside an inline node, such as emphasis or an inline footnote over two lines.
 */
function escapeOpenerLines(c: Check, e: ParagraphNode, place: number, starts: Starts): void {
  const { paragraphs, columns } = starts
  const top = e.children
  if (!paragraphs.has(place) && hasOpenerShape(top, 0) && !isPending(c, top[0])) escapeLineStart(c, top, 0, e)
  let line = Math.floor(place / PLACE_COLUMNS)
  const firstLine = line
  const nested = (node: Node | undefined): void => {
    if (node?.type !== 'text') return
    const written = c.w.lines[line] ?? ''
    // The text stands behind the prefix of its line, which can hold the same characters, as the markers of `- - -`.
    const from = written.indexOf(node.value, line === firstLine ? place % PLACE_COLUMNS : 0)
    const start = from >= 0 ? from : written.indexOf(node.value)
    if (start < 0) return
    for (const column of columns.get(line) ?? []) {
      const at = column - start < 0 ? -1 : nestedOpener(node.value, column - start)
      if (at >= 0 && at < node.value.length && escapeAt(c, node, at)) {
        const known = c.ownEscapes.get(node) ?? new Set<number>()
        known.add(at)
        c.ownEscapes.set(node, known)
      }
    }
  }
  nested(top[0])
  const visit = (nodes: readonly Node[]): void => {
    for (let at = 0; at < nodes.length; at++) {
      const node = nodes[at]!
      if ('children' in node) visit(node.children)
      if (!isBreak(node)) continue
      line++
      const opens = opensOn(starts, line, firstLine) && hasOpenerShape(nodes, at + 1)
      if (opens && !isPending(c, nodes[at + 1])) escapeLineStart(c, nodes, at + 1, e)
      nested(nodes[at + 1])
    }
  }
  visit(top)
}

/**
 * Whether the parse starts a block on `line` of a paragraph whose first line is `first`. A paragraph there opens nothing
 * where its container holds the first line too: the block above it ended. In a container that starts later it is a
 * line of that container.
 */
function opensOn(starts: Starts, line: number, first: number): boolean {
  if (starts.columns.has(line)) return true
  const container = starts.containers.get(line)
  return container !== undefined && container > first
}

/**
 * After a block read back as another block, the blocks behind it are not compared one by one.
 * This finds the other lines of the group that opened a block, by the lines at which the parse
 * `parsed` has one, so that one round escapes all of them (C2-W-092). `offset` is the line of
 * the parse at which the group starts.
 */
export function escapeOpeners(c: Check, parsed: DocumentNode, offset: number): void {
  if (!c.misaligned) return
  const starts: Starts = { paragraphs: new Set(), columns: new Map(), containers: new Map() }
  readStarts(parsed, offset, starts)
  for (const [node, place] of c.w.starts) {
    if (node.attrs === undefined && node.lang === undefined) escapeOpenerLines(c, node, place, starts)
  }
}

/** Compares the blocks `es` with their parse `as` in order. Returns false where the blocks behind cannot be compared. */
function compareInOrder(c: Check, es: readonly Node[], as: readonly Node[], absorbed: boolean): boolean {
  let read = 0
  for (let at = 0; at < es.length && read < as.length; at++) {
    // A lost block that reads as the last block of the one above is reported once, not with every container it joined.
    const takes = at === es.length - 1 ? absorbed : es.length - at > as.length - read && c.w.lost.has(es[at + 1]!)
    if (!compareBlock(c, es[at]!, as[read++]!, takes)) return false
    // Such lost blocks take no block of the parse, so the blocks behind them meet their own parse (C2-B-137).
    while (takes && es.length - at - 1 > as.length - read && c.w.lost.has(es[at + 1]!)) at++
  }
  return true
}

/** Whether the inlines of `e` hold a lost soft break: its blank line split the block, which is reported there. */
function holdsLostBreak(c: Check, e: Node): boolean {
  if (!isInlineParent(e)) return false
  return childNodes(e).some((node) => (node.type === 'soft_break' && c.w.lost.has(node)) || holdsLostBreak(c, node))
}

/** Compares the blocks `es` of `owner`, as they were written, with their parse `as`. */
export function compareBlocks(c: Check, es: readonly Node[], as: readonly Node[], owner: Node, absorbed = false): void {
  const before = changes(c)
  if (!compareInOrder(c, es, as, absorbed)) return
  // What a lost block was written as has its own count of blocks.
  if (es.length === as.length || changes(c) > before || es.some((e) => c.w.lost.has(e) || holdsLostBreak(c, e))) return
  if (absorbed && es.length < as.length) return
  // A line of a line block that reads as its closer ends the block (C2-B-123).
  const missing = es[as.length]
  // The blocks below differ in number, so a line of one of them may have opened a block (C2-W-092).
  c.misaligned = true
  if (owner.type === 'line_block' && missing !== undefined) escapeLineStart(c, childNodes(missing), 0, missing)
  else if (es.length > as.length) missingBlock(c, es[as.length]!)
  else c.losses.push([owner, null])
}
