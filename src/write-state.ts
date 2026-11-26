// What one run of the writer holds (spec/0.2/writer.md): the lines written so far, the escapes
// and spellings the reparse asked for (C2-W-089), the facts of the sidecar and the losses.
import { type DocumentNode, type Inline, type Node, type ParagraphNode, type TextNode } from './ast.ts'
import { addFinding, type Diagnostic, type Findings } from './diagnostics.ts'
import { type ExtensionDefinition } from './extensions/types.ts'
import { type Plan } from './write-plan.ts'
import { type OpenerRuns } from './write-blocks.ts'

/**
 * The sources `parseChunk` has seen since the last clear, with the tree of each short or repeated one. A tree is not held
 * through the rounds before it is asked again, which cost more in garbage collection (carve#6411); a repeat counts no parse.
 */
export interface ParseCache {
  trees: Map<string, DocumentNode | null>
  /** The characters of the sources whose trees are kept. */
  treeChars: number
  /** The last sources too long for `trees`, with their trees, newest first. */
  recent: [string, DocumentNode][]
}

/** The facts of the sidecar that the writer reads (C2-L-046), by node. */
export interface WriterFacts {
  bare?: boolean
  fenced?: boolean
  hardBreakOpener?: boolean
  continuationLines?: number
  wraps?: readonly { line: number, path: string, offset: number, row?: number, col?: number }[]
  rawRef?: string
  optionSpelling?: Record<string, string>
  sourceFormat?: string
  headerRows?: number
}

/** One node that did not read back, and how far the writer is in the ways to make it form. */
/** What a pass of the repair read and charged, so a later pass can stand in for it (write-passes.ts). */
export interface PassTrace {
  /** The switches its rounds read (`READ_*`). */
  reads: number
  /** The trials it handed to `logTrials`, in order. */
  logged: [TextNode, number][][]
  /** Where it found the trial log closed to a retest, as the number of `logged` entries before each check. */
  checks: number[]
  /** Its parses outside a kept probe: the source, and the tree where `parseChunk` keeps short ones (C2-W-133). */
  charges: [string, DocumentNode | null, boolean][]
  /** The parses of rounds a chain step stood in for (write-chain.ts): their count and their characters. */
  skipped: [number, number]
  /**
   * The nodes of `bracedAnyway` it found absent, and those whose add alone told a chain step's states apart
   * (write-chain.ts): a start that already holds one of them would change a read or a comparison.
   */
  braced: Set<Node>
  /** The trials it read `wholeTrials` for (C2-W-125), each with the writer as it stood there; null past their cap. */
  wholeTests: WholeTest[] | null
}

/** A trial a pass without `wholeTrials` read the switch for, which a pass with it would test (write-passes.ts). */
export interface WholeTest {
  state: Map<keyof Writer, unknown>
  linkPlaced: Map<TextNode, Set<number>>
  work: Writer['work']
  parses: number
  /** `givesTree` for the trial, as the pass with the switch runs it. */
  gives: () => boolean
}

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
  /**
   * C2-B-003: the width of the pending lead in front of its innermost quote mark that the prefix of the continuation
   * lines does not have, so a body opened behind that mark does not count it.
   */
  leadSkip: number
  /** C2-W-044: the bare-dot item marker, with its attributes and space, waiting on this line. */
  bareDotLead: string | null
  /** C2-W-088: the offsets in the value of a text node that take a backslash, in ascending order. */
  escapes: Map<TextNode, number[]>
  /** While set, each backslash of `escapes` is written as `mark` and listed in `written`, in the order written. */
  escapeTrace: { mark: string, written: [TextNode, number][] } | null
  /** The lines the last prune of `escapes` gave, with the group and the lines it started from (carve-js#5715). */
  prunedFrom: { group: readonly Node[], written: readonly string[], lines: readonly string[] } | null
  /** Braced kinds reported by this group's repair rounds. */
  reportedBraceKinds: Set<string>
  /** The spelling of a node that has more than one: 0 is the first choice of its clause. */
  forms: Map<Node, number>
  /** C2-W-069: the nodes braced only because their bare mark glued to the same mark before them in the last write. */
  glued: Set<Node>
  /** C2-W-069, C2-W-070: the emphasis and strong nodes braced whatever their form. */
  bracedAnyway: Set<Node>
  /** C2-W-125 case eight: the links whose caret stays bare behind the escaped closers of a text note. */
  caseEightLinks: Set<Node>
  /** C2-W-123: the colon containers written without their closer, which a comment line ends with their last fence. */
  openColons: Set<Node>
  /** Where each paragraph of the group being written starts: its line in `lines` and its column, as one number. */
  starts: Map<ParagraphNode, number>
  /** What the reparse has tried for a node that did not form: the step it is at, and the escapes of that step. */
  attempts: Map<Node, Attempt>
  facts: Map<Node, WriterFacts> | null
  /**
   * C2-W-088, C2-W-075: the rounds read every reference from the tree, so this is false while they run; afterwards
   * a reference takes its verbatim text unless it is in `treeReferences`.
   */
  verbatimRefs: boolean
  treeReferences: Set<Node>
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
  /** C2-B-137: the line comments reported because the open container above reads them in. */
  readComments: Set<Node>
  /** C2-W-136: the keys of `attrs` of a node that were reported and not written; the reparse check does not ask for them. */
  lostKeys: Map<Node, string[]>
  /** C2-W-050: the tree holds a key value with a line feed, which the writer spells with a space. */
  lineFeedValues: boolean
  /** What `lose` and `loseKey` added, in order (a key, or null for the node), so a refused round takes it back. */
  lossLog: [Node, string | null][]
  /** The longest colon run among the fenced containers below a node (C2-W-039). */
  colonRuns: Map<Node, number>
  /** Whether emphasis (1) and strong (2) occur below a node (C2-W-070). */
  kindsBelow: Map<Node, number>
  /** The content key of each node `extendClosers` compared, kept for the rounds of one group. */
  contentKeys: Map<Node, string>
  /** C2-I-098: the expansion of each term the document defines. */
  abbreviations: Map<string, string>
  /** Definition keys of the whole document, used while reparsing one written block. */
  linkKeys: ReadonlySet<string>
  /** The parse of the group of blocks as it was last written (C2-W-089). */
  parsed: DocumentNode | null
  prewrittenAttributes: Node | null
  /** C2-I-118: images write the brackets of their alt text bare, for a group past the depth cap where they are text. */
  bareAlts: boolean
  /** C2-I-118: the escapes the comparison placed at once behind capped openers, in the order the rounds would place them. */
  cappedRuns: [TextNode, number][]
  /** C2-W-088: false while a group is written again by rounds of the reported openers only. */
  kindRounds: boolean
  /** C2-W-088, C2-W-005: true while a group whose closer repairs gave no kind lost a node is written again with them. */
  closerKinds: boolean
  /**
   * C2-W-088, C2-W-125 case five: false while the rounds write the brackets of link text bare. The first round turns it
   * on where its parse asks for a change inside a link; the bare text reports its kinds otherwise (carve#6656).
   */
  linkFallback: boolean
  /** Whether a write of the rounds since `linkFallback` was turned off wrote a link. */
  sawLink: boolean
  /** The backslashes `linkFallback` added, which a repair that starts bare takes out first. */
  linkPlaced: Map<TextNode, Set<number>>
  /** C2-W-125: true while a group that every other form lost is written again keeping a trial that gives the tree. */
  wholeTrials: boolean
  /** C2-W-125: the trials of a `wholeTrials` pass, tested again together once the escapes behind them are placed. */
  trialLog: [TextNode, number][] | null
  /** C2-W-125: true once a `wholeTrials` pass tested its logged trials together, which it does once. */
  trialsRetested: boolean
  /** The blocks of the document root, each with the one before it: only there does a typed opener open a metadata block (C2-B-232). */
  topBlocks: ReadonlyMap<Node, Node | undefined>
  /** C2-W-155: the departures of every run of top-level lists, built once on first use (write-blocks.ts). */
  openerRuns: OpenerRuns | null
  /** C2-W-010: the plan is taken without the test of C2-W-088 kinds, after the rounds lost a node it keeps. */
  planKinds: boolean
  /** Why the plan left the last group to the repair, or null. */
  planWhy: string | null
  /** The plan of the group being written, while the writer plans it (write-plan.ts). */
  plan: Plan | null
  /** The parses the writer made, for the test that the planned path makes none. */
  parses: number
  /** Parsed short blocks reused when no document-level definitions affect them (write-check.ts `parseChunk`). */
  parseCache: ParseCache
  /** Source validation is fixed for a node during this write, even when planning rewrites its group. */
  extensionSources: Map<Node, { canonical: boolean; readsBack?: boolean }>
  /** Bytes of source parsed into this tree, supplied only by the formatter. */
  verifiedSourceBytes: Uint8Array | undefined
  /** The bytes of the sidecar's source, for the authored-block fallback of C2-W-088; null without a sidecar. */
  authored: Uint8Array | null
  /** C2-W-088: the leaf blocks written with their authored content instead of their spelling, while that fallback tries them. */
  authoredLeaves: Map<Node, string>
  /** C2-W-075: the label of a collapsed reference whose content does not fold to its key, by the content written. */
  collapsedLabels: Map<Node, Map<string, string>>
  /** C2-W-075: the inline read of each collapsed label candidate inside its brackets, by the candidate. */
  labelReads: Map<string, Inline[]>
  /** C2-W-002: the read-back results of the last sources a group wrote (write.ts `readsBack`), by source. */
  readBacks: Map<string, ReadBack[]>
  /** C2-W-088: the result of each probe of the repair by the state it reads (write-check.ts), and an id of each node it read. */
  probes: Map<string, ProbeResult>
  nodeIds: Map<Node, number>
  /** The text nodes that stand in for markup in a probe, one per node they stand beside, so that a probe keeps their identity. */
  standIns: Map<Node, Map<string, TextNode>>
  /** Whether a content line written alone opens a block, by its text (write-check.ts). */
  lineOpens: Map<string, boolean>
  /**
   * C2-W-133: the characters every parse of the writer read, probes included, which share this record, and its limit.
   * The repairs of all groups draw on one budget: `spent` is what they read, `source` the length of the document
   * where the writer has it, `written` the characters of the groups written so far, `rewritten` what the rounds of
   * all repairs wrote.
   */
  work: { chars: number, limit: number, spent: number, source: number, written: number, rewritten: number }
  /** Prototype: the frontmatter that stands first in the document and may use the bare opener (C2-B-161). */
  leadingFrontmatter: Node | null
  /** What the pass being run read and charged (write-passes.ts), shared with its probes; null outside a pass. */
  pass: PassTrace | null
}

/** Whether a source read back as `group`, with the setting the comparison read. */
export interface ReadBack {
  group: readonly Node[]
  lineFeedValues: boolean
  result: boolean
}

/** What one probe of the repair found: its result and the escapes it asked of the comparison, in order. */
export interface ProbeResult {
  found: boolean | null
  taken: [TextNode, number][]
  /** The escapes among `taken` that are content-start trials (`leadTrials` in write-check.ts). */
  leads?: [TextNode, number][]
}

export function createWriter(facts: Map<Node, WriterFacts> | null, alignTables: boolean,
  extensions: readonly ExtensionDefinition[] = []): Writer {
  return {
    extensions,
    lines: [], lead: null, leadSkip: 0, bareDotLead: null, escapes: new Map(), escapeTrace: null, prunedFrom: null,
    reportedBraceKinds: new Set(),
    forms: new Map(), glued: new Set(),
    bracedAnyway: new Set(), caseEightLinks: new Set(),
    openColons: new Set(), starts: new Map(),
    attempts: new Map(), facts, verbatimRefs: true, treeReferences: new Set(), wrapPoints: null,
    wrapStarts: null,    alignTables, blankFirst: false, losses: { entries: [], nodes: [] }, lost: new Set(), readComments: new Set(),
    lostKeys: new Map(), lineFeedValues: false,
    lossLog: [], colonRuns: new Map(), kindsBelow: new Map(), contentKeys: new Map(), abbreviations: new Map(), linkKeys: new Set(),
    parsed: null,
    prewrittenAttributes: null, bareAlts: false, cappedRuns: [], kindRounds: true, closerKinds: false,
    linkFallback: true, sawLink: false, linkPlaced: new Map(), wholeTrials: false,
    trialLog: null, trialsRetested: false,
    topBlocks: new Map(),
    openerRuns: null, planKinds: false, planWhy: null, plan: null,
    parses: 0, parseCache: { trees: new Map(), treeChars: 0, recent: [] },
    extensionSources: new Map(), verifiedSourceBytes: undefined, authored: null, authoredLeaves: new Map(), collapsedLabels: new Map(),
    labelReads: new Map(), readBacks: new Map(),
    probes: new Map(), nodeIds: new Map(), standIns: new Map(), lineOpens: new Map(),
    work: { chars: 0, limit: Infinity, spent: 0, source: 0, written: 0, rewritten: 0 },
    leadingFrontmatter: null, pass: null,
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
  w.leadSkip = 0
  w.bareDotLead = null
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
  w.lossLog.push([node, key])
  const message = `Carve source cannot spell the key ${key} in the attrs of a ${node.type} node beside the table fields that write it`
  const entry: Diagnostic = { code: 'field-unspellable', severity: 'warning', channel: 'render-loss', message }
  addFinding(w.losses, node, entry)
  w.losses.steps ??= new Map()
  w.losses.steps.set(entry, `/attrs/keyValues/${index}`)
}

/** C2-W-075: the verbatim text of a reference as the sidecar records it, where the writer may take it now. */
export function recordedRaw(w: Writer, node: Node): string | undefined {
  if (!w.verbatimRefs || !('key' in node) || node.key === undefined || w.treeReferences.has(node)) return undefined
  return w.facts?.get(node)?.rawRef
}

/** Whether `node` is in `bracedAnyway`; a pass notes a node it finds absent, which a later member would change. */
export function isBracedAnyway(w: Writer, node: Node): boolean {
  if (w.bracedAnyway.has(node)) return true
  w.pass?.braced.add(node)
  return false
}

export function lose(w: Writer, node: Node, field: string | null): void {
  if (w.lost.has(node)) return
  w.lost.add(node)
  w.lossLog.push([node, null])
  const message = field === null
    ? `Carve source cannot spell a ${node.type} node here`
    : field === '' ? `Carve source cannot spell the fields of a ${node.type} node here`
      : `Carve source cannot spell the field ${field} of a ${node.type} node here`
  const code = field === null ? 'structure-unspellable' : 'field-unspellable'
  const entry: Diagnostic = { code, severity: 'warning', channel: 'render-loss', message }
  addFinding(w.losses, node, entry)
  if (field !== null && Object.hasOwn(node, field)) {
    w.losses.steps ??= new Map()
    w.losses.steps.set(entry, `/${field}`)
  }
}

/** A point in the losses of `w` that `rollBackLosses` returns to. */
export interface LossMark {
  entries: number
  log: number
}

export function markLosses(w: Writer): LossMark {
  return { entries: w.losses.entries.length, log: w.lossLog.length }
}

/** Takes back every loss reported after `mark`, without copying the losses of the whole document. */
export function rollBackLosses(w: Writer, mark: LossMark): void {
  w.losses.entries.length = mark.entries
  w.losses.nodes.length = mark.entries
  while (w.lossLog.length > mark.log) {
    const [node, key] = w.lossLog.pop()!
    if (key === null) {
      w.lost.delete(node)
      continue
    }
    const keys = w.lostKeys.get(node)!.slice(0, -1)
    if (keys.length === 0) w.lostKeys.delete(node)
    else w.lostKeys.set(node, keys)
  }
}
