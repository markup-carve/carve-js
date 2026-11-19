// What one run of the writer holds (spec/0.2/writer.md): the lines written so far, the escapes
// and spellings the reparse asked for (C2-W-089), the facts of the sidecar and the losses.
import { type DocumentNode, type Node, type ParagraphNode, type TextNode } from './ast.ts'
import { addFinding, type Diagnostic, type Findings } from './diagnostics.ts'
import { type ExtensionDefinition } from './extensions/types.ts'
import { type Plan } from './write-plan.ts'

/** The facts of the sidecar that the writer reads (C2-L-046), by node. */
export interface WriterFacts {
  bare?: boolean
  fenced?: boolean
  hardBreakOpener?: boolean
  continuationLines?: number
  wraps?: readonly { line: number, path: string, offset: number, row?: number }[]
  rawRef?: string
  optionSpelling?: Record<string, string>
  sourceFormat?: string
  headerRows?: number
}

/** One node that did not read back, and how far the writer is in the ways to make it form. */
export interface Attempt {
  step: number
  escapes: [TextNode, number][]
}

export interface Writer {
  extensions: readonly ExtensionDefinition[]
  /** The lines of the blocks being written, without their line endings. */
  lines: string[]
  /** What the next line starts with instead of its prefix: the markers of the items it opens (C2-W-027). */
  lead: string | null
  /** C2-W-044: a bare-dot item marker is waiting on this line. */
  bareDotLead: boolean
  /** C2-W-088: the offsets in the value of a text node that take a backslash, in ascending order. */
  escapes: Map<TextNode, number[]>
  /** The spelling of a node that has more than one: 0 is the first choice of its clause. */
  forms: Map<Node, number>
  /** Where each paragraph of the group being written starts: its line in `lines` and its column, as one number. */
  starts: Map<ParagraphNode, number>
  /** What the reparse has tried for a node that did not form: the step it is at, and the escapes of that step. */
  attempts: Map<Node, Attempt>
  facts: Map<Node, WriterFacts> | null
  /** C2-L-020: the offsets in the value of a text node at which the fragment of a continuation row starts. */
  wrapPoints: Map<TextNode, number[]> | null
  /** C2-L-021: the nodes of a cell whose start is the start of the fragment of a continuation row. */
  wrapStarts: Set<Node> | null
  alignTables: boolean
  /** C2-W-005: the output starts with one blank line, because its first block reads differently on line 1 (C2-B-161). */
  blankFirst: boolean
  /** C2-W-011: what could not be written, one entry per node. */
  losses: Findings
  lost: Set<Node>
  /** C2-W-136: the keys of `attrs` of a node that were reported and not written; the reparse check does not ask for them. */
  lostKeys: Map<Node, string[]>
  /** The longest colon run among the fenced containers below a node (C2-W-039). */
  colonRuns: Map<Node, number>
  /** Whether emphasis (1) and strong (2) occur below a node (C2-W-070). */
  kindsBelow: Map<Node, number>
  /** C2-I-098: the expansion of each term the document defines. */
  abbreviations: Map<string, string>
  /** Definition keys of the whole document, used while reparsing one written block. */
  linkKeys: ReadonlySet<string>
  /** The parse of the group of blocks as it was last written (C2-W-089). */
  parsed: DocumentNode | null
  prewrittenAttributes: Node | null
  /** The plan of the group being written, while the writer plans it (write-plan.ts). */
  plan: Plan | null
  /** The parses the writer made, for the test that the planned path makes none. */
  parses: number
  /** C2-W-088: the result of each probe of the repair by the state it reads (write-check.ts), and an id of each node it read. */
  probes: Map<string, ProbeResult>
  nodeIds: Map<Node, number>
  /** The text nodes that stand in for markup in a probe, one per node they stand beside, so that a probe keeps their identity. */
  standIns: Map<Node, Map<string, TextNode>>
  /** Whether a content line written alone opens a block, by its text (write-check.ts). */
  lineOpens: Map<string, boolean>
  /** C2-W-133: the characters every parse of the writer read, probes included, which share this record, and its limit. */
  work: { chars: number, limit: number }
}

/** What one probe of the repair found: its result and the escapes it asked of the comparison, in order. */
export interface ProbeResult {
  found: boolean | null
  taken: [TextNode, number][]
}

export function createWriter(facts: Map<Node, WriterFacts> | null, alignTables: boolean,
  extensions: readonly ExtensionDefinition[] = []): Writer {
  return {
    extensions,
    lines: [], lead: null, bareDotLead: false, escapes: new Map(), forms: new Map(), starts: new Map(),
    attempts: new Map(), facts, wrapPoints: null,
    wrapStarts: null,    alignTables, blankFirst: false, losses: { entries: [], nodes: [] }, lost: new Set(),
    lostKeys: new Map(), colonRuns: new Map(), kindsBelow: new Map(), abbreviations: new Map(), linkKeys: new Set(), parsed: null,
    prewrittenAttributes: null, plan: null, parses: 0,
    probes: new Map(), nodeIds: new Map(), standIns: new Map(), lineOpens: new Map(), work: { chars: 0, limit: Infinity },
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
export function notePlace(w: Writer, node: ParagraphNode, prefix: string): void {
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
  w.bareDotLead = false
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
    // C2-W-059, C2-B-138: a comment-only line stands at the column of the leaf that holds it, not at its content column.
    inner = text.startsWith('%%', start) ? prefix : prefix + indent
  }
}

/** C2-W-011, C2-W-117: records that `node`, or its field `field`, could not be written. One entry per node. */
/** C2-W-136: the key at `index` of the `attrs` of `node` has no spelling beside the field that writes the same key. */
export function loseKey(w: Writer, node: Node, index: number, key: string): void {
  const keys = w.lostKeys.get(node) ?? []
  if (keys.includes(key)) return
  w.lostKeys.set(node, [...keys, key])
  const message = `the key ${key} in the attrs of a ${node.type} node has no spelling beside the table fields that write it`
  const entry: Diagnostic = { code: 'field-unspellable', severity: 'warning', channel: 'render-loss', message }
  addFinding(w.losses, node, entry)
  w.losses.steps ??= new Map()
  w.losses.steps.set(entry, `/attrs/keyValues/${index}`)
}

export function lose(w: Writer, node: Node, field: string | null): void {
  if (w.lost.has(node)) return
  w.lost.add(node)
  const message = field === null
    ? `a ${node.type} node has no spelling in Carve source here`
    : `the field ${field} of a ${node.type} node has no spelling in Carve source here`
  const code = field === null ? 'structure-unspellable' : 'field-unspellable'
  const entry: Diagnostic = { code, severity: 'warning', channel: 'render-loss', message }
  addFinding(w.losses, node, entry)
  if (field !== null && Object.hasOwn(node, field)) {
    w.losses.steps ??= new Map()
    w.losses.steps.set(entry, `/${field}`)
  }
}
