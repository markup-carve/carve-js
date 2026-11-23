// The checks of the writer (spec/0.2/writer.md): its two gates, with and without the sidecar,
// that a canonical input stays as it is, and that its escapes are those of the procedure of C2-W-088.
import { format, formatWithDiagnostics, lint, parse, treesEqual, write, writeWithDiagnostics } from '../../src/index.ts'
import { childNodes, isInlineParent, type DocumentNode, type Node, type Position, type TextNode } from '../../src/ast.ts'
import { type Diagnostic } from '../../src/diagnostics.ts'
import { unitBytes } from '../../src/positions.ts'
import { isNode } from './nodes.ts'

// C2-W-016: the inline leaves whose later lines are lines of the leaf.
const VERBATIM_SPANS = ['code', 'literal_inline', 'math', 'raw_inline', 'comment', 'critic_comment']

function nodeAt(tree: DocumentNode, path: string): unknown {
  let at: unknown = tree
  for (const part of path.split('/').slice(1)) at = (at as Record<string, unknown> | undefined)?.[part]
  return at
}

/** C2-W-016: whether `value` holds a CR at the end of a line, which the line ending takes. */
function endsLineWithCr(value: string): boolean {
  for (let at = value.indexOf('\r'); at >= 0; at = value.indexOf('\r', at + 1)) {
    if (at + 1 === value.length || value[at + 1] === '\n') return true
  }
  return false
}

/**
 * C2-W-016 and C2-W-133: whether the writer refused an unspellable field or a repeated repair state.
 */
export function isRefusal(tree: DocumentNode, diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((entry) => {
    if (entry.code === 'writer-refused' || typedDashParagraph(tree, entry)) return true
    const found = entry.path === undefined ? undefined : nodeAt(tree, entry.path)
    const parentPath = entry.path?.slice(0, entry.path.lastIndexOf('/')) ?? ''
    const parent = nodeAt(tree, parentPath)
    const node = isNode(found) ? found : isNode(parent) ? parent : undefined
    const value = refusalValue(found, node)
    const multiline = node !== undefined && VERBATIM_SPANS.includes(node.type) && value.includes('\n')
    const fields = node === undefined ? [] : Object.values(node).filter((field): field is string => typeof field === 'string')
    return entry.code === 'field-unspellable' && (multiline || fields.some(endsLineWithCr))
  })
}

/** C2-W-154: below a list, footnote or description list this paragraph has no spelling yet (carve#6394). */
function typedDashParagraph(tree: DocumentNode, entry: Diagnostic): boolean {
  if (entry.code !== 'structure-unspellable' || !/^\/children\/\d+$/.test(entry.path ?? '')) return false
  const paragraph = nodeAt(tree, entry.path!)
  return isNode(paragraph) && paragraph.type === 'paragraph' && childNodes(paragraph)[0]?.type === 'smart_punctuation'
}

function refusalValue(found: unknown, node: Node | undefined): string {
  if (typeof found === 'string') return found
  return node !== undefined && 'value' in node && typeof node.value === 'string' ? node.value : ''
}

function isAsciiAlphanumeric(code: number): boolean {
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isAsciiPunctuation(code: number): boolean {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)
}

/** The string offset of each UTF-8 byte offset of `src` at which a character starts, and of its end. */
function stringOffsets(src: string): Map<number, number> {
  const offsets = new Map<number, number>()
  let bytes = 0
  for (let at = 0; at <= src.length; at++) {
    offsets.set(bytes, at)
    if (at < src.length) bytes += unitBytes(src, at)
  }
  return offsets
}

interface Placed {
  node: Node
  inCell: boolean
}

/** Every node of `tree` with `pos`, in document order, and whether it stands in a table cell. */
function placedNodes(tree: Node): Placed[] {
  const out: Placed[] = []
  const visit = (value: unknown, inCell: boolean): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, inCell)
      return
    }
    if (typeof value !== 'object' || value === null) return
    const record = value as Record<string, unknown>
    const cell = inCell || record['type'] === 'table_cell'
    if (isNode(value) && value.pos !== undefined) out.push({ node: value, inCell: cell })
    for (const key in record) if (key !== 'pos') visit(record[key], cell)
  }
  visit(tree, false)
  return out
}

/**
 * The offsets of `written` of the backslashes that escape a character of a text node: the escapes
 * of C2-W-088. A backslash written as two (C2-W-097) and a pipe in a cell (C2-W-098) are not among them.
 */
function textEscapes(written: string, placed: readonly Placed[], offsets: Map<number, number>): number[] {
  const out: number[] = []
  for (const { node, inCell } of placed) {
    if (node.type === 'text' && node.pos !== undefined) nodeEscapes(written, node, node.pos, inCell, offsets, out)
  }
  return out.sort((x, y) => x - y)
}

/** Adds the escapes of one text node, walking its source and its value side by side. */
function nodeEscapes(
  written: string, node: TextNode, pos: Position, inCell: boolean, offsets: Map<number, number>, out: number[],
): void {
  const value = node.value
  let at = offsets.get(pos.startOffset) ?? -1
  const end = offsets.get(pos.endOffset) ?? -1
  for (let index = 0; at >= 0 && at < end && index < value.length; index++) {
    const next = written[at + 1]
    if (written[at] === '\\' && at + 1 < end && isAsciiPunctuation(written.charCodeAt(at + 1)) && value[index] === next) {
      if (next !== '\\' && !cellEscape(inCell, next, value.length)) out.push(at)
      at += 2
    } else if (written[at] === value[index]) {
      at++
    } else {
      // A join of a continuation row: the rest of the node keeps its escapes.
      return
    }
  }
}

function cellEscape(inCell: boolean, next: string | undefined, length: number): boolean {
  return inCell && (next === '|' || (length === 1 && (next === '^' || next === '<')))
}

/** The number of entries of the ascending list `sorted` below `offset`. */
function countBelow(sorted: readonly number[], offset: number): number {
  let count = 0
  while (count < sorted.length && sorted[count]! < offset) count++
  return count
}

/** The name of a construct: its type, and for smart punctuation its kind, which a neighbor can decide (C2-I-104). */
function constructName(node: Node): string {
  return node.type === 'smart_punctuation' ? `${node.type}:${node.kind}` : node.type
}

/** The constructs of a parse as `type@offset`, with offsets in the bare text, and the bare offset at which each ends. */
function constructEnds(placed: readonly Placed[], offsets: Map<number, number>, toBare: (at: number) => number): Map<string, number> {
  const ends = new Map<string, number>()
  for (const { node } of placed) {
    if (node.type === 'text' || node.type === 'document' || node.pos === undefined) continue
    ends.set(`${constructName(node)}@${toBare(offsets.get(node.pos.startOffset) ?? -1)}`, toBare(offsets.get(node.pos.endOffset) ?? -1))
  }
  return ends
}

/** The text `bare` with a backslash before each offset of `added`, and the offset in `bare` of each of its offsets. */
function withEscapes(bare: string, added: readonly number[]): { text: string, toBare: number[] } {
  let text = ''
  const toBare: number[] = []
  let next = 0
  for (let at = 0; at <= bare.length; at++) {
    if (next < added.length && added[next] === at) {
      text += '\\'
      toBare.push(at)
      next++
    }
    if (at < bare.length) text += bare[at]
    toBare.push(at)
  }
  return { text, toBare }
}

// C2-W-090: in a sigil glued to a bracket or a backtick the backslash stands before the bracket or the backtick.
const RUN_ENDS = '[`'

/**
 * C2-W-090, C2-W-099: the offset of the opener of a construct that starts at `start`: its first ASCII
 * punctuation, the second of a hyphen run unless that one starts a dash of the tree, and the bracket or
 * backtick that ends a run of sigils, unless that one opens a construct of the tree.
 */
function openerAt(text: string, start: number, end: number, holdsStart: (at: number) => boolean): number {
  for (let at = start; at < end; at++) {
    if (!isAsciiPunctuation(text.charCodeAt(at)) || text[at] === '\\') continue
    if (text[at] === '-') return text[at + 1] === '-' && !holdsStart(at + 1) ? at + 1 : at
    let run = at
    while (run + 1 < end && '!^$'.includes(text[run]!) && isAsciiPunctuation(text.charCodeAt(run + 1))) run++
    // Where the bracket or backtick opens a construct of the tree, the run takes the backslash on its first sigil.
    return RUN_ENDS.includes(text[run]!) && !holdsStart(run) ? run : at
  }
  return -1
}

interface Construct {
  start: number
  end: number
  type: string
}

/**
 * The constructs of `parsed` that the tree does not hold, in source order. A node the tree holds that took
 * an attribute block the tree does not give it ends later: the block is that construct.
 */
function unheldConstructs(parsed: Node, text: string, toBare: readonly number[], held: Map<string, number>): Construct[] {
  const offsets = stringOffsets(text)
  const found: Construct[] = []
  for (const { node } of placedNodes(parsed)) {
    if (node.type === 'text' || node.type === 'document' || node.type === 'paragraph' || node.pos === undefined) continue
    let start = offsets.get(node.pos.startOffset) ?? -1
    const end = offsets.get(node.pos.endOffset) ?? -1
    let type = constructName(node)
    const heldEnd = held.get(`${constructName(node)}@${toBare[start]!}`)
    if (heldEnd !== undefined) {
      if (node.attrs === undefined || heldEnd >= toBare[end]!) continue
      start = toBare.indexOf(heldEnd)
      type = 'attribute block'
    }
    found.push({ start, end, type })
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end)
  return found.filter((item, at) => at === 0 || item.start !== found[at - 1]!.start)
}

export type ReferenceForm = { form: string } | { gap: string }

const QUOTE_KINDS = ['left_double_quote', 'right_double_quote', 'left_single_quote', 'right_single_quote']
const DASH_KINDS = ['en_dash', 'em_dash']

/** The first held construct named `prefix...@start`, as its name and its end, or null. */
function heldAt(held: Map<string, number>, prefix: string, start: number): [string, number] | null {
  for (const [key, end] of held) {
    if (key.startsWith(prefix) && key.endsWith(`@${start}`)) return [key.slice(0, key.lastIndexOf('@')), end]
  }
  return null
}

/**
 * C2-W-125, the cases decided at the construct the procedure would escape: where the right neighbor decides
 * the direction of a smart quote of the tree, the neighbor takes the backslash, and where a hyphen run starts
 * with a dash of the tree and ends in text, the first hyphen behind the dash takes it. Returns -1 otherwise.
 */
function neighborBackslash(type: string, start: number, bare: string, held: Map<string, number>): number {
  const kind = type.slice(type.indexOf(':') + 1)
  if (QUOTE_KINDS.includes(kind)) {
    const quote = heldAt(held, 'smart_punctuation:', start)
    const decided = quote !== null && quote[0] !== type && QUOTE_KINDS.includes(quote[0].slice(quote[0].indexOf(':') + 1))
    if (!decided) return -1
    if ('!<>'.includes(bare[start + 1] ?? '') && bare[start + 2] === '=') return start + 2
    // The quote is the tree's, read the other way: it is no construct to escape, and a neighbor of another kind decides.
    return isAsciiPunctuation(bare.charCodeAt(start + 1)) ? start + 1 : UNFORMED
  }
  if (DASH_KINDS.includes(kind)) {
    const dash = heldAt(held, 'smart_punctuation:', start)
    const isDash = dash !== null && DASH_KINDS.includes(dash[0].slice(dash[0].indexOf(':') + 1))
    return isDash && dash[0] !== type && bare[dash[1]] === '-' ? dash[1] : -1
  }
  return -1
}

/** A node of the tree read in another direction, which takes no backslash of its own (C2-W-125). */
const UNFORMED = -2

/** Where the attribute block that ends the construct `[start, end)` of `bare`, which has one, starts. */
function ownAttributes(bare: string, start: number, end: number): number {
  const open = bare.lastIndexOf('{', end - 1)
  return bare[end - 1] !== '}' || open <= start ? end : open
}

/** What the cases of C2-W-125 that are decided at the end of the procedure read of the bare text and the tree. */
interface Unformed {
  bare: string
  startsHeld: Set<number>
  attributed: Set<string>
  added: readonly number[]
}

function isBareBrace(u: Unformed, at: number): boolean {
  return u.bare[at] === '{' && u.bare[at - 1] !== '\\' && !u.startsHeld.has(at) && !u.added.includes(at)
}

/**
 * The brace that reads on into the construct `key` of the tree: the one glued before it, unless it is a braced
 * form, or else the last one inside it before its attribute block, or else the nearest one before it. -1 for none.
 */
function braceInto(u: Unformed, key: string, start: number, end: number): number {
  if (u.bare[start] !== '{' && isBareBrace(u, start - 1)) return start - 1
  const inner = u.attributed.has(key) ? ownAttributes(u.bare, start, end) : end
  for (let at = inner - 1; at > start; at--) if (isBareBrace(u, at)) return at
  for (let at = start - 1; at >= 0; at--) if (isBareBrace(u, at)) return at
  return -1
}

/**
 * C2-W-125, the cases decided where the procedure ends with a node of the tree unformed: a sigil before the
 * bracket of a footnote reference of the tree takes the backslash, and otherwise the brace that reads on into a
 * construct of the tree, the leftmost of each. `missing` holds the constructs of the tree that the text with the
 * backslashes of this clause lacks, as `name@start` with their ends, in bare offsets. Returns -1 where none applies.
 */
function closerInside(u: Unformed, type: string, start: number, end: number): number {
  if (!['inline_footnote', 'inline_extension', 'emphasis', 'strong'].includes(type)) return -1
  const mark = type === 'strong' ? '*' : type === 'emphasis' ? '/' : ''
  for (let at = start + 1; at < end - 1; at++) {
    if (u.added.includes(at)) continue
    if (u.bare.startsWith('/}', at) || innerCloser(u.bare, type, mark, start, at)) return at
  }
  return -1
}

function innerCloser(bare: string, type: string, mark: string, start: number, at: number): boolean {
  if (mark !== '' && bare[at] === mark && !(bare[start] === '{' && at === start + 1)) return true
  return (type === 'inline_footnote' || type === 'inline_extension') && '[]'.includes(bare[at] ?? '')
}

function firstCandidate(current: number, candidate: number): number {
  return candidate < 0 ? current : current < 0 ? candidate : Math.min(current, candidate)
}

function addedBackslashes(u: Unformed, missing: Map<string, number>): number[] {
  let sigil = -1
  let brace = -1
  let closer = -1
  for (const [key, end] of missing) {
    const at = key.lastIndexOf('@')
    const start = Number(key.slice(at + 1))
    const type = key.slice(0, at)
    const isSigil = type === 'footnote_ref' && '^!'.includes(u.bare[start - 1] ?? ' ') && !u.added.includes(start - 1)
    if (isSigil) sigil = firstCandidate(sigil, start - 1)
    brace = firstCandidate(brace, braceInto(u, key, start, end))
    closer = firstCandidate(closer, closerInside(u, type, start, end))
  }
  return [brace, sigil, closer].filter((at) => at >= 0)
}

/** The constructs of `held` that the parse of `text` does not hold. */
function missingConstructs(parsed: Node, text: string, toBare: readonly number[], held: Map<string, number>): Map<string, number> {
  const formed = constructEnds(placedNodes(parsed), stringOffsets(text), (at) => toBare[at] ?? -1)
  const missing = new Map<string, number>()
  for (const [key, end] of held) if (!formed.has(key)) missing.set(key, end)
  return missing
}

/** The text of `written` bare of the escapes of its text nodes, the constructs of the tree and those with attributes. */
interface BareText {
  bare: string
  held: Map<string, number>
  startsHeld: Set<number>
  attributed: Set<string>
  /** The bare ranges of the text nodes of each leaf block, the unit of a kind round (C2-W-088). */
  blocks: [number, number][][]
}

/** The bare ranges of the text nodes below each outermost inline parent of `tree`, block by block. */
function textBlocks(tree: Node, offsets: Map<number, number>, toBare: (at: number) => number): [number, number][][] {
  const blocks: [number, number][][] = []
  const collect = (node: Node, out: [number, number][]): void => {
    if (node.type === 'text' && node.pos !== undefined) {
      out.push([toBare(offsets.get(node.pos.startOffset) ?? -1), toBare(offsets.get(node.pos.endOffset) ?? -1)])
    }
    for (const child of childNodes(node)) collect(child, out)
  }
  const visit = (node: Node): void => {
    if (!isInlineParent(node)) {
      for (const child of childNodes(node)) visit(child)
      return
    }
    const ranges: [number, number][] = []
    collect(node, ranges)
    blocks.push(ranges)
  }
  visit(tree)
  return blocks
}

function bareText(written: string): BareText {
  const offsets = stringOffsets(written)
  const placed = placedNodes(parse(written))
  const removed = textEscapes(written, placed, offsets)
  let bare = ''
  let from = 0
  for (const at of removed) {
    bare += written.slice(from, at)
    from = at + 1
  }
  bare += written.slice(from)
  const toBare = (at: number): number => at - countBelow(removed, at)
  const held = constructEnds(placed, offsets, toBare)
  const startsHeld = new Set([...held.keys()].map((key) => Number(key.slice(key.lastIndexOf('@') + 1))))
  const attributed = new Set(constructEnds(placed.filter(({ node }) => node.attrs !== undefined), offsets, toBare).keys())
  return { bare, held, startsHeld, attributed, blocks: textBlocks(parse(written), offsets, toBare) }
}

/** The bare offset the construct asks to escape and whether that escape gives a kind, or null for none. */
function constructTarget(text: string, toBare: readonly number[], construct: Construct, source: BareText,
  added: readonly number[]): [number, boolean] | null {
  const neighbor = neighborBackslash(construct.type, toBare[construct.start]!, source.bare, source.held)
  if (neighbor === UNFORMED) return null
  if (neighbor >= 0) return [sigilTarget(source, added, neighbor), false]
  const opener = openerAt(text, construct.start, construct.end, (at) => source.startsHeld.has(toBare[at]!))
  if (opener < 0) return null
  const target = toBare[opener]!
  const adjusted = sigilTarget(source, added, target)
  return [adjusted, adjusted === target]
}

/** The bare offsets this read-back parse asks to escape, one per unexpected construct. */
function roundEscapes(text: string, toBare: readonly number[], parsed: Node, source: BareText, added: readonly number[]):
  { targets: number[], best: Construct | null } {
  const unheld = unheldConstructs(parsed, text, toBare, source.held)
  const targets: number[] = []
  for (const construct of unheld) {
    const found = constructTarget(text, toBare, construct, source, added)
    if (found === null || found[0] < 0) continue
    const [target, kind] = found
    if (!added.includes(target) && !targets.includes(target)) targets.push(target)
    if (kind) kindTargets(source, added, target, targets)
  }
  return { targets, best: unheld[0] ?? null }
}

/**
 * Whether `at` starts a line of its block: what stands before it on the line is spaces, tabs and the prefix of the
 * containers, none of it text of the block.
 */
function lineStart(source: BareText, at: number): boolean {
  const block = source.blocks.find((ranges) => ranges.some(([start, end]) => at >= start && at < end))
  for (let k = at - 1; k >= 0 && source.bare[k] !== '\n'; k--) {
    if (source.bare[k] === ' ' || source.bare[k] === '\t') continue
    if (block?.some(([start, end]) => k >= start && k < end) === true) return false
  }
  return true
}

/**
 * C2-W-088: an escape that gives a line kind or no kind: at a line start, the delimiter of an ordered marker there,
 * or a block opener behind the marker of another block on the same line.
 */
function lineOpener(source: BareText, at: number): boolean {
  const bare = source.bare
  const digits = ordinalStart(bare, at)
  if (digits < at) return lineStart(source, digits)
  if (lineStart(source, at)) return true
  let gap = at
  while (gap > 0 && (bare[gap - 1] === ' ' || bare[gap - 1] === '\t')) gap--
  if (gap === at || gap === 0) return false
  const marker = '-*+>:'.includes(bare[gap - 1]!) ? gap - 1 : ordinalStart(bare, gap - 1)
  return marker < gap - 1 || '-*+>:'.includes(bare[marker]!) ? lineStart(source, marker) : false
}

/** The start of the digits or letters before the delimiter `.` or `)` at `at` of an ordered marker, else `at`. */
function ordinalStart(bare: string, at: number): number {
  if (!'.)'.includes(bare[at] ?? ' ')) return at
  let k = at
  while (k > 0 && /[0-9A-Za-z]/.test(bare[k - 1]!)) k--
  return k
}

/**
 * C2-W-088: the other openers of the kind of the escape at `at` in its block: the first character of each run of
 * that character in the text of the block. Only the kinds of one character outside a line start are modeled; a
 * brace, a slash, a star, a hyphen, a backtick and a line kind are left to `kindExplained`. A backslash of C2-W-125
 * gives no kind.
 */
function kindTargets(source: BareText, added: readonly number[], at: number, targets: number[]): void {
  const bare = source.bare
  const ch = bare[at]!
  if ('{/*-`'.includes(ch) || lineOpener(source, at)) return
  const block = source.blocks.find((ranges) => ranges.some(([start, end]) => at >= start && at < end))
  if (block === undefined) return
  for (const [start, end] of block) {
    for (let k = start; k < end; k++) {
      if (bare[k] !== ch || (k > start && bare[k - 1] === ch) || lineStart(source, k)) continue
      if (!added.includes(k) && !targets.includes(k)) targets.push(k)
    }
  }
}

/**
 * The procedure of C2-W-088 from the backslashes `seeds`: the form it reaches, or the text at which it ends
 * with the tree unformed and the construct it last looked at.
 */
type ProcedureEnd = { form: string, toBare: number[] } | { text: string, best: Construct | null }

/** The constructs of the parse of `bare` with the backslashes `added`, as `name@start` with their ends, in bare offsets. */
function formedConstructs(bare: string, added: readonly number[]): Map<string, number> {
  const { text, toBare } = withEscapes(bare, [...added].sort((x, y) => x - y))
  return constructEnds(placedNodes(parse(text)), stringOffsets(text), (at) => toBare[at] ?? -1)
}

/**
 * C2-W-125, case seven: where the backslash before the sigil `:` at `at` changes the direction of the smart
 * quote of the tree before it, the bracket of that opener takes the backslash. Returns `at` otherwise.
 */
function sigilTarget(source: BareText, added: readonly number[], at: number): number {
  const bare = source.bare
  if (comparisonTarget(source, added, at)) return at + 1
  if (bare[at] !== ':') return at
  const quote = heldAt(source.held, 'smart_punctuation:', at - 1)
  if (quote === null || !QUOTE_KINDS.includes(quote[0].slice(quote[0].indexOf(':') + 1))) return at
  if (formedConstructs(bare, [...added, at]).has(`${quote[0]}@${at - 1}`)) return at
  let bracket = at + 1
  while (bracket < bare.length && (isAsciiAlphanumeric(bare.charCodeAt(bracket)) || '_-'.includes(bare[bracket]!))) bracket++
  return bracket > at + 1 && bare[bracket] === '[' ? bracket : at
}

function comparisonTarget(source: BareText, added: readonly number[], at: number): boolean {
  const bare = source.bare
  if (!'!<>'.includes(bare[at] ?? '') || bare[at + 1] !== '=') return false
  const quote = heldAt(source.held, 'smart_punctuation:', at - 1)
  return quote !== null && QUOTE_KINDS.includes(quote[0].slice(quote[0].indexOf(':') + 1)) &&
    !formedConstructs(bare, [...added, at]).has(`${quote[0]}@${at - 1}`)
}

/**
 * C2-W-125, case six: a construct of the tree that the character behind it lengthens or keeps from forming,
 * as a backtick behind a code span or a name character behind a mention. Returns the bare offset of the
 * leftmost such character, or -1.
 */
function lengthenedEnd(source: BareText, seeds: readonly number[]): number {
  const formed = formedConstructs(source.bare, seeds)
  let best = -1
  for (const [key, end] of source.held) {
    const now = formed.get(key)
    const bare = source.bare
    if (seeds.includes(end) || !isAsciiPunctuation(bare.charCodeAt(end))) continue
    // Formed longer, or kept from forming by a closing run that the character makes longer.
    if (now === undefined ? bare[end] !== bare[end - 1] : now <= end) continue
    if (best < 0 || end < best) best = end
  }
  return best
}

function runProcedure(source: BareText, tree: DocumentNode, seeds: readonly number[]): ProcedureEnd {
  const added = [...seeds].sort((x, y) => x - y)
  for (;;) {
    const { text, toBare } = withEscapes(source.bare, added)
    const parsed = parse(text)
    if (treesEqual(parsed, tree)) return { form: text, toBare }
    const { targets, best } = roundEscapes(text, toBare, parsed, source, added)
    if (targets.length === 0) return { text, best }
    added.push(...targets)
    added.sort((x, y) => x - y)
  }
}

/** C2-W-125: find a punctuation escape that restores a node when its missing construct has no simple boundary. */
function punctuationRepair(source: BareText, tree: DocumentNode, seeds: readonly number[]): number {
  let first = -1
  for (let at = 0; at < source.bare.length; at++) {
    if (seeds.includes(at) || !isAsciiPunctuation(source.bare.charCodeAt(at))) continue
    if (!('form' in runProcedure(source, tree, [...seeds, at]))) continue
    if (source.bare[at] === '{') return at
    if (first < 0) first = at
  }
  return first
}

/** C2-W-125: the first punctuation escape that, with those placed, reads as the tree without another step of the procedure. */
function aloneRepair(source: BareText, tree: DocumentNode, seeds: readonly number[]): number {
  for (let at = 0; at < source.bare.length; at++) {
    if (seeds.includes(at) || !isAsciiPunctuation(source.bare.charCodeAt(at))) continue
    if (treesEqual(parse(withEscapes(source.bare, [...seeds, at].sort((x, y) => x - y)).text), tree)) return at
  }
  return -1
}

function nextRepair(source: BareText, tree: DocumentNode, seeds: readonly number[], missing: Map<string, number>): number {
  const lengthened = lengthenedEnd(source, seeds)
  const candidates = [...addedBackslashes({ ...source, added: seeds }, missing), lengthened]
    .filter((at) => at >= 0 && !seeds.includes(at))
  for (const candidate of candidates) if ('form' in runProcedure(source, tree, [...seeds, candidate])) return candidate
  const alone = aloneRepair(source, tree, seeds)
  if (alone >= 0) return alone
  // C2-W-125: where no case gives the tree alone, case six keeps its backslash when it fits.
  if (lengthened >= 0 && !seeds.includes(lengthened)) return lengthened
  const repair = punctuationRepair(source, tree, seeds)
  return repair >= 0 ? repair : candidates[0] ?? -1
}

// C2-W-146: the pair rules of lint, with the length of the opening run each one reports.
const PAIR_RULES = new Map([
  ['deprecated-bare-underline', 1], ['deprecated-bare-strike', 1], ['deprecated-bare-highlight', 1],
  ['markdown-strikethrough-double-tilde', 2], ['markdown-strong-double-star', 2],
])

/** C2-W-091: the backslashes the procedure placed stay, and it runs again with those the pairs ask for. */
function keepPlaced(seeds: number[], toBare: readonly number[], paired: readonly number[]): void {
  for (let at = 0; at + 1 < toBare.length; at++) {
    if (toBare[at] === toBare[at + 1] && !seeds.includes(toBare[at]!)) seeds.push(toBare[at]!)
  }
  seeds.push(...paired.filter((at) => !seeds.includes(at)))
}

/** C2-W-146: the bare offsets of the marks of each opening run that a pair rule of lint reports in `form`. */
function pairSeeds(form: string, toBare: readonly number[], seeds: readonly number[]): number[] {
  const offsets = stringOffsets(form)
  const found: number[] = []
  for (const entry of lint(form)) {
    const run = PAIR_RULES.get(entry.code)
    const start = entry.range === undefined ? undefined : offsets.get(entry.range.startOffset)
    if (run === undefined || start === undefined) continue
    for (let at = start; at < start + run; at++) {
      const bare = toBare[at]
      if (bare !== undefined && !seeds.includes(bare) && !found.includes(bare)) found.push(bare)
    }
  }
  return found
}

/**
 * C2-W-088, C2-W-091, C2-W-125, C2-W-146: the escapes of the procedure, as a slow reference. The text of `written` is
 * taken bare of the escapes of its text nodes and parsed; while the parse holds constructs that
 * `tree` does not hold, the opener of each one takes a backslash in the same round.
 * Where the procedure ends with a node of the tree
 * unformed, the backslash of C2-W-125 is placed and the procedure runs again with it. Quadratic, for small inputs.
 */
export function referenceForm(written: string, tree: DocumentNode): ReferenceForm {
  const source = bareText(written)
  const seeds: number[] = []
  for (let restart = 0; restart <= source.bare.length; restart++) {
    const result = runProcedure(source, tree, seeds)
    if ('form' in result) {
      const paired = pairSeeds(result.form, result.toBare, seeds)
      if (paired.length === 0) return { form: result.form }
      keepPlaced(seeds, result.toBare, paired)
      continue
    }
    const seeded = withEscapes(source.bare, [...seeds].sort((x, y) => x - y))
    const missing = missingConstructs(parse(seeded.text), seeded.text, seeded.toBare, source.held)
    const extra = nextRepair(source, tree, seeds, missing)
    if (extra < 0) {
      const best = result.best
      const what = best === null
        ? 'no construct the tree does not hold'
        : `the ${best.type} at ${best.start}, whose opener takes no backslash`
      return { gap: `the parse of ${JSON.stringify(result.text)} differs from the tree, holds ${what}, and C2-W-125 places nothing` }
    }
    seeds.push(extra)
  }
  return { gap: `no fixed point for ${JSON.stringify(written)}` }
}

/**
 * C2-W-088: the offset of the first backslash of `written` that the procedure does not place, or -1.
 * The written form and the form of the procedure are compared byte for byte by the gates; this names the first difference.
 */
export function unaskedEscape(written: string, tree: DocumentNode): number {
  const reference = referenceForm(written, tree)
  if (!('form' in reference)) return -1
  const form = reference.form
  for (let at = 0; at < written.length; at++) if (written[at] !== form[at]) return written[at] === '\\' ? at : -1
  return -1
}

/** The bare text of `form` and, by bare offset, the backslashes it places. */
function escapedOffsets(form: string): { bare: string, escaped: Set<number> } {
  let bare = ''
  const escaped = new Set<number>()
  for (let at = 0; at < form.length; at++) {
    if (form[at] === '\\' && at + 1 < form.length && isAsciiPunctuation(form.charCodeAt(at + 1))) {
      escaped.add(bare.length)
      bare += form[++at]
      continue
    }
    bare += form[at]
  }
  return { bare, escaped }
}

/**
 * C2-W-088: a round escapes every opener of a reported kind in its block, which the slow reference leaves out. The
 * written form passes where it holds every backslash of the reference, and each other one stands in a block of
 * lines in which the reference already escapes a character of that kind.
 */
function kindExplained(written: string, form: string): boolean {
  const a = escapedOffsets(written)
  const b = escapedOffsets(form)
  if (a.bare !== b.bare) return false
  if ([...b.escaped].some((at) => !a.escaped.has(at) && canOpenDelimiter(b.bare, at))) return false
  const blockOf = (at: number): [number, number] => {
    let start = a.bare.lastIndexOf('\n\n', at)
    start = start < 0 ? 0 : start + 2
    const end = a.bare.indexOf('\n\n', at)
    return [start, end < 0 ? a.bare.length : end]
  }
  return [...a.escaped].every((at) => {
    if (b.escaped.has(at)) return true
    const [start, end] = blockOf(at)
    return [...b.escaped].some((other) => other >= start && other < end && a.bare[other] === a.bare[at])
  })
}

/**
 * C2-I-047, C2-I-049: a slash or a star that its neighbors let open. The slow reference escapes the closer of a
 * reported pair as well; under C2-W-088 only the delimiters that can open are openers of its kind.
 */
function canOpenDelimiter(text: string, at: number): boolean {
  const char = text[at]
  if (char !== '/' && char !== '*') return true
  if (text[at - 1] === char || text[at + 1] === char) return false
  const before = text.codePointAt(at - 1) ?? 0
  const after = text[at + 1]
  return at === 0 || (!/[\p{L}\p{N}]/u.test(String.fromCodePoint(before)) && after !== undefined && !/\s/u.test(after))
}

function show(text: string): string {
  return JSON.stringify(text)
}

/** C2-W-125 adds bracket escapes inside nested links beyond the slow C2-W-088 construct procedure. */
function hasNestedLink(node: Node, inside = false): boolean {
  if (node.type === 'link' && inside) return true
  const nested = inside || node.type === 'link'
  for (const child of childNodes(node)) if (hasNestedLink(child, nested)) return true
  return false
}

/** C2-W-075 retains a recorded reference verbatim, including text escapes C2-W-088 would otherwise remove. */
function outsideRawReferences(source: string, reference: string, original: string): boolean {
  const links = (text: string): Node[] => placedNodes(parse(text))
    .map(({ node }) => node).filter((node) => (node.type === 'link' || node.type === 'image') && node.key !== undefined)
  const writtenLinks = links(source)
  const referenceLinks = links(reference)
  if (writtenLinks.length === 0 || writtenLinks.length !== referenceLinks.length) return false
  const mask = (text: string, nodes: readonly Node[], requireRaw: boolean): string | null => {
    const offsets = stringOffsets(text)
    let result = text
    for (let at = nodes.length - 1; at >= 0; at--) {
      const pos = nodes[at]?.pos
      const start = pos === undefined ? undefined : offsets.get(pos.startOffset)
      const end = pos === undefined ? undefined : offsets.get(pos.endOffset)
      if (start === undefined || end === undefined) return null
      if (requireRaw && !original.includes(text.slice(start, end))) return null
      result = `${result.slice(0, start)}\u0000${result.slice(end)}`
    }
    return result
  }
  const a = mask(source, writtenLinks, true)
  const b = mask(reference, referenceLinks, false)
  return a !== null && a === b
}

/**
 * The gates on one written form: it parses to `tree` (C2-W-002) and its escapes are those of the procedure
 * (C2-W-088), byte for byte. Where neither the procedure nor C2-W-125 reaches the tree, the clauses do not
 * decide the form; such an input is added to `undecided` and only C2-W-002 and C2-W-003 hold for it.
 */
function checkWritten(
  tree: DocumentNode, written: string, losses: readonly Diagnostic[], path: string, undecided: string[], original?: string,
): string | null {
  if (losses.length > 0) {
    const reported = losses.map((entry) => `${entry.code} at ${show(entry.path ?? '')}`).join(', ')
    return `${path}: the writer reports ${reported}, written ${show(written)}`
  }
  if (!treesEqual(tree, parse(written))) return `${path}: C2-W-002, the written form parses to another tree: ${show(written)}`
  // The independent reference is quadratic and covers small inputs. It models inline constructs but
  // not a nested link's bracket ownership or a plus line's attachment. Clause cases pin those bytes;
  // all inputs still take the readback and stability gates here.
  if (written.length <= 1024) {
    const reference = referenceForm(written, tree)
    if ('gap' in reference) undecided.push(`${path}: ${show(written)}: ${reference.gap}`)
    else if (reference.form !== written && !hasNestedLink(tree) && !written.includes('\\+') &&
      !(original !== undefined && outsideRawReferences(written, reference.form, original)) &&
      !kindExplained(written, reference.form)) {
      return `${path}: C2-W-088, written ${show(written)}, the procedure gives ${show(reference.form)}`
    }
  }
  // C2-W-003 on the formatter path, and a canonical input stays as it is.
  const again = format(written)
  return again === written ? null : `${path}: the canonical form ${show(written)} is formatted to ${show(again)}`
}

/** The result of the checks on one source: null, a failure, or `refused` (C2-W-016, C2-W-133). */
export function checkWriter(src: string, undecided: string[] = []): string | null {
  const tree = parse(src)
  const formatted = formatWithDiagnostics(src)
  const plain = writeWithDiagnostics(tree)
  const losses = formatted.diagnostics.filter((entry) => entry.channel === 'render-loss')
  const recordedRefusal = isRefusal(tree, losses)
  const plainRefusal = isRefusal(tree, plain.diagnostics)
  const failure = (recordedRefusal ? null : checkWritten(tree, formatted.source, losses, 'with the record', undecided, src))
    ?? (plainRefusal ? null : checkWritten(tree, plain.source, plain.diagnostics, 'without the record', undecided))
  if (failure !== null) return failure
  if (recordedRefusal || plainRefusal) return 'refused'
  // C2-W-003 without the sidecar.
  const again = write(parse(plain.source))
  return again === plain.source ? null : `without the record: C2-W-003, ${show(plain.source)} is written again as ${show(again)}`
}

/** Whether a failure of `checkWriter` is a loss the writer reported (C2-W-011), not a form that reads back differently silently. */
export function isReportedLoss(failure: string): boolean {
  return failure.includes(': the writer reports ')
}

export interface WriterEnumerationResult {
  documents: number
  refused: number
  /** The first failures of every kind, reported losses included. */
  failures: string[]
  failureCount: number
  /** The inputs with a reported loss (C2-W-011), counted and listed apart, and the first of them. */
  lossCount: number
  losses: string[]
  /** The inputs whose escapes C2-W-088 does not decide, and the first of them. */
  undecided: number
  undecidedSamples: string[]
}

const MAX_REPORTED = 20

/** Checks one source into `result`. */
function checkInto(src: string, result: WriterEnumerationResult, maxReported: number): void {
  const undecided: string[] = []
  let failure: string | null
  try {
    failure = checkWriter(src, undecided)
  } catch (error) {
    failure = `threw ${String(error)}`
  }
  if (undecided.length > 0) {
    result.undecided++
    if (result.undecidedSamples.length < maxReported) result.undecidedSamples.push(`${show(src)}: ${undecided[0]!}`)
  }
  if (failure === 'refused') result.refused++
  else if (failure !== null) {
    result.failureCount++
    if (result.failures.length < maxReported) result.failures.push(`${show(src)}: ${failure}`)
    if (!isReportedLoss(failure)) return
    result.lossCount++
    if (result.losses.length < maxReported) result.losses.push(`${show(src)}: ${failure}`)
  }
}

/** Checks every document of exactly `length` parts of `alphabet`, joined by `glue` behind `prefix`. */
export function enumerateWriter(
  alphabet: readonly string[], length: number, glue: string, prefix: string, maxReported = MAX_REPORTED,
): WriterEnumerationResult {
  const result: WriterEnumerationResult = {
    documents: 0, refused: 0, failures: [], failureCount: 0, lossCount: 0, losses: [], undecided: 0, undecidedSamples: [],
  }
  const choice = new Array<number>(length).fill(0)
  const parts = new Array<string>(length).fill('')
  for (;;) {
    for (let at = 0; at < length; at++) parts[at] = alphabet[choice[at]!]!
    result.documents++
    checkInto(prefix + parts.join(glue), result, maxReported)
    let at = length - 1
    while (at >= 0 && choice[at] === alphabet.length - 1) choice[at--] = 0
    if (at < 0) return result
    choice[at]!++
  }
}

export interface GateResult {
  /** A gate that failed, or null. */
  failure: string | null
  /** The losses the writer reported (C2-W-011), or null where it reported none. */
  losses: string | null
  refused: boolean
}

/**
 * The gates alone, without the slow reference of C2-W-088: the formatted source parses to the tree
 * of the source (C2-W-002), formatting it again gives the same bytes (C2-W-003), and writing the
 * parse of the written form again gives the same bytes. C2-W-002 has no exception for a parsed
 * document, so a loss the writer reports fails it too; the loss is returned apart to name it.
 */
export function checkGates(src: string): GateResult {
  const tree = parse(src)
  const formatted = formatWithDiagnostics(src)
  const found = formatted.diagnostics.filter((entry) => entry.channel === 'render-loss')
  const refused = isRefusal(tree, found)
  const named = found.map((entry) => `${entry.code} at ${show(entry.path ?? '')}`).join(', ')
  const losses = found.length === 0 || refused ? null : `the writer reports ${named}`
  return { failure: refused ? null : gateFailure(tree, formatted.source), losses, refused }
}

function gateFailure(tree: DocumentNode, source: string): string | null {
  if (!treesEqual(tree, parse(source))) return `C2-W-002, ${show(source)} parses to another tree`
  const again = format(source)
  if (again !== source) return `format(format(x)) is ${show(again)}, format(x) is ${show(source)}`
  const plain = write(tree)
  const rewritten = write(parse(plain))
  return rewritten === plain ? null : `C2-W-003, ${show(plain)} is written again as ${show(rewritten)}`
}

/** A seeded generator of numbers in [0, 1), so that a failing run can be repeated (mulberry32). */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface RandomRunResult {
  documents: number
  refused: number
  /** The first failures that come with no reported loss. */
  failures: string[]
  failureCount: number
  losses: string[]
  lossCount: number
  /** The failures that come with no reported loss: an output that differs silently (C2-W-011). */
  silentCount: number
}

/** Checks `count` sources that `build` makes from the generator, with `checkGates`. */
export function randomWriter(
  count: number, random: () => number, build: (random: () => number) => string, maxReported = MAX_REPORTED,
): RandomRunResult {
  const result: RandomRunResult = { documents: 0, refused: 0, failures: [], failureCount: 0, losses: [], lossCount: 0, silentCount: 0 }
  for (let at = 0; at < count; at++) {
    const src = build(random)
    result.documents++
    countGates(result, src, guardedGates(src), maxReported)
  }
  return result
}

function guardedGates(src: string): GateResult {
  try {
    return checkGates(src)
  } catch (error) {
    return { failure: `threw ${String(error)}`, losses: null, refused: false }
  }
}

function countGates(result: RandomRunResult, src: string, gates: GateResult, maxReported: number): void {
  if (gates.refused) result.refused++
  if (gates.failure !== null) {
    result.failureCount++
    if (gates.losses === null) result.silentCount++
    if (gates.losses === null && result.failures.length < maxReported) result.failures.push(`${show(src)}: ${gates.failure}`)
  }
  if (gates.losses === null) return
  result.lossCount++
  if (result.losses.length < maxReported) result.losses.push(`${show(src)}: ${gates.losses}`)
}
