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

// C2-W-090 does not say which character of an opener run takes the backslash (_SPEC_GAPS.md): the
// run of a sigil before a bracket or a backtick run takes it on that bracket or backtick, as the engine places it.
const RUN_ENDS = '[`'

/**
 * C2-W-090, C2-W-099: the offset of the opener of a construct that starts at `start`: its first ASCII
 * punctuation, the second of a hyphen run, and the bracket or backtick that ends a run of sigils, unless that
 * one opens a construct of the tree.
 */
function openerAt(text: string, start: number, end: number, holdsStart: (at: number) => boolean): number {
  for (let at = start; at < end; at++) {
    if (!isAsciiPunctuation(text.charCodeAt(at)) || text[at] === '\\') continue
    // Beyond the clause (_SPEC_GAPS.md): where the second hyphen starts a dash of the tree, the first takes it.
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
    let type: string = node.type
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

/**
 * C2-W-088, C2-W-091: the escapes of the procedure, as a slow reference. The text of `written` is
 * taken bare of the escapes of its text nodes and parsed; while the parse holds a construct that
 * `tree` does not hold, the opener of the leftmost one (by start, the outer of two at one start)
 * takes a backslash and the text is parsed again. Quadratic, for small inputs.
 */
export function referenceForm(written: string, tree: DocumentNode): ReferenceForm {
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
  const held = constructEnds(placed, offsets, (at) => at - countBelow(removed, at))
  const startsHeld = new Set([...held.keys()].map((key) => Number(key.slice(key.lastIndexOf('@') + 1))))
  const added: number[] = []
  for (let round = 0; round <= bare.length; round++) {
    const { text, toBare } = withEscapes(bare, added)
    const parsed = parse(text)
    if (treesEqual(parsed, tree)) return { form: text }
    const best = leftmostUnheld(parsed, text, toBare, held)
    const holdsStart = (at: number): boolean => startsHeld.has(toBare[at]!)
    const opener = best === null ? -1 : openerAt(text, best.start, best.end, holdsStart)
    const target = opener < 0 ? -1 : toBare[opener]!
    if (target < 0 || added.includes(target)) {
      const what = best === null
        ? 'no construct the tree does not hold'
        : `the ${best.type} at ${best.start}, whose opener takes no backslash`
      return { gap: `the parse of ${JSON.stringify(text)} differs from the tree, and holds ${what}` }
    }
    added.push(target)
    added.sort((x, y) => x - y)
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
 * (C2-W-088), byte for byte. Where the procedure cannot reach the tree, the clause does not decide the form
 * (_SPEC_GAPS.md); such an input is added to `undecided` and only C2-W-002 and C2-W-003 hold for it.
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
