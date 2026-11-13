// What one run of the writer holds (spec/0.2/writer.md): the lines written so far, the escapes
// and spellings the reparse asked for (C2-W-089), the facts of the sidecar and the losses.
import { type AstNode } from './ast.ts'
import { addFinding, type Findings } from './diagnostics.ts'

/** The facts of the sidecar that the writer reads (C2-L-046), by node. */
export interface WriterFacts {
  bare?: boolean
  fenced?: boolean
  hardBreakOpener?: boolean
  continuationLines?: number
  wraps?: readonly { line: number, path: string, offset: number, row?: number }[]
  rawRef?: string
  sourceFormat?: string
}

/** One node that did not read back, and how far the writer is in the ways to make it form. */
export interface Attempt {
  step: number
  escapes: [AstNode, number][]
}

export interface Writer {
  /** The lines of the blocks being written, without their line endings. */
  lines: string[]
  /** What the next line starts with instead of its prefix: the markers of the items it opens (C2-W-027). */
  lead: string | null
  /** C2-W-088: the offsets in the value of a text node that take a backslash, in ascending order. */
  escapes: Map<AstNode, number[]>
  /** The spelling of a node that has more than one: 0 is the first choice of its clause. */
  forms: Map<AstNode, number>
  /** Where each paragraph of the group being written starts: its line in `lines` and its column, as one number. */
  starts: Map<AstNode, number>
  /** What the reparse has tried for a node that did not form: the step it is at, and the escapes of that step. */
  attempts: Map<AstNode, Attempt>
  facts: Map<AstNode, WriterFacts> | null
  /** C2-L-020: the offsets in the value of a text node at which the fragment of a continuation row starts. */
  wrapPoints: Map<AstNode, number[]> | null
  alignTables: boolean
  /** C2-W-005: the output starts with one blank line, because its first block reads differently on line 1 (C2-B-161). */
  blankFirst: boolean
  /** C2-W-011: what could not be written, one entry per node. */
  losses: Findings
  lost: Set<AstNode>
  /** The longest colon run among the fenced containers below a node (C2-W-039). */
  colonRuns: Map<AstNode, number>
  /** Whether emphasis (1) and strong (2) occur below a node (C2-W-070). */
  kindsBelow: Map<AstNode, number>
  /** C2-I-098: the expansion of each term the document defines. */
  abbreviations: Map<string, string>
}

export function createWriter(facts: Map<AstNode, WriterFacts> | null, alignTables: boolean): Writer {
  return {
    lines: [], lead: null, escapes: new Map(), forms: new Map(), starts: new Map(), attempts: new Map(), facts, wrapPoints: null, alignTables, blankFirst: false, losses: { entries: [], nodes: [] }, lost: new Set(),
    colonRuns: new Map(), kindsBelow: new Map(), abbreviations: new Map(),
  }
}

const SPACE = 32
const TAB = 9

/** The length of `line` without the spaces and tabs at its end. */
function trimmedLength(line: string): number {
  let end = line.length
  while (end > 0 && (line.charCodeAt(end - 1) === SPACE || line.charCodeAt(end - 1) === TAB)) end--
  return end
}

/** The columns a line can have in a place of `Writer.starts`. */
export const PLACE_COLUMNS = 8192

/** Notes where the paragraph `node` starts, for the test of its lines after a parse (C2-W-092). */
export function notePlace(w: Writer, node: AstNode, prefix: string): void {
  const head = w.lead ?? prefix
  // Columns count code points, so only a prefix of markers and spaces is measured by its length.
  for (let at = 0; at < head.length; at++) if (head.charCodeAt(at) > 127) return
  if (head.length < PLACE_COLUMNS) w.starts.set(node, w.lines.length * PLACE_COLUMNS + head.length)
}

/** `text` without the spaces and tabs at its end. */
export function trimEnd(text: string): string {
  return text.slice(0, trimmedLength(text))
}

/** Writes one line behind the pending lead or `prefix`. C2-W-021: an empty line has no spaces of its prefix either. */
export function emit(w: Writer, prefix: string, text: string): void {
  const head = w.lead ?? prefix
  w.lead = null
  w.lines.push(text === '' ? trimEnd(head) : head + text)
}

/** Writes the lines of `text`: the first behind the lead or `prefix`, the others behind `prefix` and `indent`. */
export function emitLines(w: Writer, prefix: string, indent: string, text: string): void {
  let start = 0
  let inner = prefix
  for (;;) {
    const end = text.indexOf('\n', start)
    emit(w, inner, end < 0 ? text.slice(start) : text.slice(start, end))
    if (end < 0) return
    start = end + 1
    inner = prefix + indent
  }
}

/** C2-W-011, C2-W-117: records that `node`, or its field `field`, could not be written. One entry per node. */
export function lose(w: Writer, node: AstNode, field: string | null): void {
  if (w.lost.has(node)) return
  w.lost.add(node)
  const message = field === null
    ? `a ${node.type} node has no spelling in Carve source here`
    : `the field ${field} of a ${node.type} node has no spelling in Carve source here`
  addFinding(w.losses, node, { code: field === null ? 'structure-unspellable' : 'field-unspellable', severity: 'warning', channel: 'render-loss', message })
}
