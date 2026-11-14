// The checks of the writer (spec/0.2/writer.md): its two gates, with and without the sidecar,
// that a canonical input stays as it is, and that its escapes are those of the procedure of C2-W-088.
import { format, formatWithDiagnostics, parse, treesEqual, write, writeWithDiagnostics } from '../../src/index.ts'
import { type DocumentNode, type Node, type Position, type TextNode } from '../../src/ast.ts'
import { type Diagnostic } from '../../src/diagnostics.ts'
import { isNode } from './nodes.ts'

const VERBATIM_SPANS = ['code', 'literal_inline', 'math', 'raw_inline']

function nodeAt(tree: DocumentNode, path: string): Node | undefined {
  let at: unknown = tree
  for (const part of path.split('/').slice(1)) at = (at as Record<string, unknown> | undefined)?.[part]
  return at as Node | undefined
}

/**
 * C2-W-016: whether the writer refused the document for a verbatim span whose later line would
 * open a block. Such a document has no canonical spelling, and the refusal is its result.
 */
export function isRefusal(tree: DocumentNode, diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((entry) => {
    const node = entry.path === undefined ? undefined : nodeAt(tree, entry.path)
    const multiline = node !== undefined && VERBATIM_SPANS.includes(node.type) && ('value' in node ? node.value : '').includes('\n')
    return entry.code === 'field-unspellable' && multiline
  })
}

function isAsciiPunctuation(code: number): boolean {
  return (code >= 33 && code <= 47) || (code >= 58 && code <= 64) || (code >= 91 && code <= 96) || (code >= 123 && code <= 126)
}

function unitBytes(code: number): number {
  if (code < 0x80) return 1
  return code < 0x800 || (code >= 0xd800 && code <= 0xdfff) ? 2 : 3
}

/** The string offset of each UTF-8 byte offset of `src` at which a character starts, and of its end. */
function stringOffsets(src: string): Map<number, number> {
  const offsets = new Map<number, number>()
  let bytes = 0
  for (let at = 0; at <= src.length; at++) {
    offsets.set(bytes, at)
    if (at < src.length) bytes += unitBytes(src.charCodeAt(at))
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
      if (next !== '\\' && !(inCell && next === '|')) out.push(at)
      at += 2
    } else if (written[at] === value[index]) {
      at++
    } else {
      // A join of a continuation row: the rest of the node keeps its escapes.
      return
    }
  }
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
 * The leftmost construct of `parsed` that the tree does not hold, the outer of two at one start. A node
 * the tree holds that took an attribute block the tree does not give it ends later: the block is that construct.
 */
function leftmostUnheld(parsed: Node, text: string, toBare: readonly number[], held: Map<string, number>): Construct | null {
  const offsets = stringOffsets(text)
  let best: Construct | null = null
  for (const { node } of placedNodes(parsed)) {
    if (node.type === 'text' || node.type === 'document' || node.pos === undefined) continue
    let start = offsets.get(node.pos.startOffset) ?? -1
    const end = offsets.get(node.pos.endOffset) ?? -1
    let type = constructName(node)
    const heldEnd = held.get(`${constructName(node)}@${toBare[start]!}`)
    if (heldEnd !== undefined) {
      if (node.attrs === undefined || heldEnd >= toBare[end]!) continue
      start = toBare.indexOf(heldEnd)
      type = 'attribute block'
    }
    if (best === null || start < best.start || (start === best.start && end > best.end)) best = { start, end, type }
  }
  return best
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
    return decided && isAsciiPunctuation(bare.charCodeAt(start + 1)) ? start + 1 : -1
  }
  if (DASH_KINDS.includes(kind)) {
    const dash = heldAt(held, 'smart_punctuation:', start)
    const isDash = dash !== null && DASH_KINDS.includes(dash[0].slice(dash[0].indexOf(':') + 1))
    return isDash && dash[0] !== type && bare[dash[1]] === '-' ? dash[1] : -1
  }
  return -1
}

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
function addedBackslash(u: Unformed, missing: Map<string, number>): number {
  let sigil = -1
  let brace = -1
  for (const [key, end] of missing) {
    const at = key.lastIndexOf('@')
    const start = Number(key.slice(at + 1))
    const isSigil = key.slice(0, at) === 'footnote_ref' && '^!'.includes(u.bare[start - 1] ?? ' ') && !u.added.includes(start - 1)
    if (isSigil && (sigil < 0 || start - 1 < sigil)) sigil = start - 1
    const into = braceInto(u, key, start, end)
    if (into >= 0 && (brace < 0 || into < brace)) brace = into
  }
  return sigil >= 0 ? sigil : brace
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
  return { bare, held, startsHeld, attributed }
}

/** The bare offset the procedure escapes next in the parse of `text`, or -1 where it holds no construct to escape. */
function nextEscape(text: string, toBare: readonly number[], parsed: Node, source: BareText): { target: number, best: Construct | null } {
  const best = leftmostUnheld(parsed, text, toBare, source.held)
  if (best === null) return { target: -1, best }
  const neighbor = neighborBackslash(best.type, toBare[best.start]!, source.bare, source.held)
  if (neighbor >= 0) return { target: neighbor, best }
  const opener = openerAt(text, best.start, best.end, (at) => source.startsHeld.has(toBare[at]!))
  return { target: opener < 0 ? -1 : toBare[opener]!, best }
}

/**
 * The procedure of C2-W-088 from the backslashes `seeds`: the form it reaches, or the text at which it ends
 * with the tree unformed and the construct it last looked at.
 */
type ProcedureEnd = { form: string } | { text: string, best: Construct | null }

function runProcedure(source: BareText, tree: DocumentNode, seeds: readonly number[]): ProcedureEnd {
  const added = [...seeds].sort((x, y) => x - y)
  for (;;) {
    const { text, toBare } = withEscapes(source.bare, added)
    const parsed = parse(text)
    if (treesEqual(parsed, tree)) return { form: text }
    const { target, best } = nextEscape(text, toBare, parsed, source)
    if (target < 0 || added.includes(target)) return { text, best }
    added.push(target)
    added.sort((x, y) => x - y)
  }
}

/**
 * C2-W-088, C2-W-091, C2-W-125: the escapes of the procedure, as a slow reference. The text of `written` is
 * taken bare of the escapes of its text nodes and parsed; while the parse holds a construct that
 * `tree` does not hold, the opener of the leftmost one (by start, the outer of two at one start)
 * takes a backslash and the text is parsed again. Where the procedure ends with a node of the tree
 * unformed, the backslash of C2-W-125 is placed and the procedure runs again with it. Quadratic, for small inputs.
 */
export function referenceForm(written: string, tree: DocumentNode): ReferenceForm {
  const source = bareText(written)
  const seeds: number[] = []
  for (let restart = 0; restart <= source.bare.length; restart++) {
    const result = runProcedure(source, tree, seeds)
    if ('form' in result) return result
    const seeded = withEscapes(source.bare, [...seeds].sort((x, y) => x - y))
    const missing = missingConstructs(parse(seeded.text), seeded.text, seeded.toBare, source.held)
    const extra = addedBackslash({ ...source, added: seeds }, missing)
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

function show(text: string): string {
  return JSON.stringify(text)
}

/**
 * The gates on one written form: it parses to `tree` (C2-W-002) and its escapes are those of the procedure
 * (C2-W-088), byte for byte. Where neither the procedure nor C2-W-125 reaches the tree, the clauses do not
 * decide the form; such an input is added to `undecided` and only C2-W-002 and C2-W-003 hold for it.
 */
function checkWritten(
  tree: DocumentNode, written: string, losses: readonly Diagnostic[], path: string, undecided: string[],
): string | null {
  if (losses.length > 0) {
    const reported = losses.map((entry) => `${entry.code} at ${show(entry.path ?? '')}`).join(', ')
    return `${path}: the writer reports ${reported}, written ${show(written)}`
  }
  if (!treesEqual(tree, parse(written))) return `${path}: C2-W-002, the written form parses to another tree: ${show(written)}`
  // C2-W-088: the written form is the one the procedure gives, byte for byte.
  const reference = referenceForm(written, tree)
  if ('gap' in reference) undecided.push(`${path}: ${show(written)}: ${reference.gap}`)
  else if (reference.form !== written) return `${path}: C2-W-088, written ${show(written)}, the procedure gives ${show(reference.form)}`
  // C2-W-003 on the formatter path, and a canonical input stays as it is.
  const again = format(written)
  return again === written ? null : `${path}: the canonical form ${show(written)} is formatted to ${show(again)}`
}

/** The result of the checks on one source: null, a failure, or `refused` (C2-W-016). Inputs C2-W-088 does not decide go to `undecided`. */
export function checkWriter(src: string, undecided: string[] = []): string | null {
  const tree = parse(src)
  const formatted = formatWithDiagnostics(src)
  const plain = writeWithDiagnostics(tree)
  const losses = formatted.diagnostics.filter((entry) => entry.channel === 'render-loss')
  if (isRefusal(tree, losses) && isRefusal(tree, plain.diagnostics)) return 'refused'
  const failure = checkWritten(tree, formatted.source, losses, 'with the record', undecided)
    ?? checkWritten(tree, plain.source, plain.diagnostics, 'without the record', undecided)
  if (failure !== null) return failure
  // C2-W-003 without the sidecar.
  const again = write(parse(plain.source))
  return again === plain.source ? null : `without the record: C2-W-003, ${show(plain.source)} is written again as ${show(again)}`
}

export interface WriterEnumerationResult {
  documents: number
  refused: number
  failures: string[]
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
  else if (failure !== null && result.failures.length < maxReported) result.failures.push(`${show(src)}: ${failure}`)
}

/** Checks every document of exactly `length` parts of `alphabet`, joined by `glue` behind `prefix`. */
export function enumerateWriter(
  alphabet: readonly string[], length: number, glue: string, prefix: string, maxReported = MAX_REPORTED,
): WriterEnumerationResult {
  const result: WriterEnumerationResult = { documents: 0, refused: 0, failures: [], undecided: 0, undecidedSamples: [] }
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
