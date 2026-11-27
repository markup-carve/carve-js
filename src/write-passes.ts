// C2-W-088, C2-W-133: the passes of one group repair start again and again from the same saved state. A pass whose
// state and the switches it read are those of an earlier pass of the same repair takes that pass's result instead of
// running its rounds again. It is charged the parses a rerun would make, and where the recorded work would pass the
// budget it runs.
import { type DocumentNode, type Node, type TextNode } from './ast.ts'
import { type Diagnostic } from './diagnostics.ts'
import { type Attempt, type PassTrace, type WholeTest, type Writer } from './write-state.ts'
import { chargeParse, exhausted } from './write-check.ts'

/** The switches of a pass that a recorded pass may have left unread (`PassTrace.reads`). */
export const READ_CLOSER_KINDS = 1
export const READ_WHOLE_TRIALS = 2
export const READ_TRIAL_LOG = 4

/**
 * How a pass treats each field of the writer. `state` is compared before a pass and restored after it, `mode` is
 * compared as the switches a pass reads, `cache` and `fixed` hold nothing a pass decides. `added` is only added to by
 * the rounds and read after the repair, so a replayed pass adds what the recorded one added. Every field is listed, so a
 * new field of `Writer` does not compile until it is placed here.
 */
const FIELDS: Record<keyof Writer, 'state' | 'added' | 'mode' | 'cache' | 'fixed' | 'work'> = {
  extensions: 'fixed', lines: 'state', lead: 'state', leadSkip: 'state', bareDotLead: 'state', escapes: 'state',
  escapeTrace: 'cache', prunedFrom: 'cache',
  reportedBraceKinds: 'state', forms: 'state', glued: 'state', bracedAnyway: 'state', caseEightLinks: 'state',
  openColons: 'state', starts: 'state', attempts: 'state', facts: 'fixed', verbatimRefs: 'state',
  treeReferences: 'state', wrapPoints: 'state', wrapStarts: 'state', alignTables: 'fixed', blankFirst: 'state',
  losses: 'state', lost: 'state', readComments: 'state', lostKeys: 'state', lineFeedValues: 'state', lossLog: 'state',
  colonRuns: 'cache', kindsBelow: 'cache', contentKeys: 'state', abbreviations: 'fixed', linkKeys: 'fixed',
  parsed: 'state', prewrittenAttributes: 'state', bareAlts: 'mode', cappedRuns: 'state', kindRounds: 'mode',
  closerKinds: 'mode', linkFallback: 'state', sawLink: 'state', linkPlaced: 'added', wholeTrials: 'mode',
  trialLog: 'mode', trialsRetested: 'mode', topBlocks: 'fixed', openerRuns: 'cache', planKinds: 'mode',
  planWhy: 'state', plan: 'state', parses: 'work', parseCache: 'cache', extensionSources: 'cache',
  verifiedSourceBytes: 'fixed', authored: 'fixed', authoredLeaves: 'state', collapsedLabels: 'cache',
  labelReads: 'cache', readBacks: 'cache', readTrees: 'cache',
  probes: 'cache', nodeIds: 'cache', standIns: 'cache', lineOpens: 'cache', work: 'work',
  leadingFrontmatter: 'fixed', pass: 'work',
}

const STATE = (Object.keys(FIELDS) as (keyof Writer)[]).filter((key) => FIELDS[key] === 'state')

/** The values of the `state` fields, in the order of `STATE`. */
export type Snapshot = unknown[]

const BRACED = STATE.indexOf('bracedAnyway')
const ESCAPES = STATE.indexOf('escapes')

/** The escapes a snapshot holds. */
export function snapshotEscapes(taken: Snapshot): Map<TextNode, number[]> {
  return taken[ESCAPES] as Map<TextNode, number[]>
}

// The fields each round writes anew, and the escapes, which a chain step compares itself (write-chain.ts).
const ROUND_FIELDS: ReadonlySet<keyof Writer> = new Set<keyof Writer>([
  'lines', 'lead', 'leadSkip', 'bareDotLead', 'glued', 'starts', 'prewrittenAttributes', 'parsed', 'escapes',
])

/**
 * Whether two snapshots hold the same state beside what each round writes anew and the escapes. Where only
 * `bracedAnyway` tells them apart, the pass notes the members that do (`bracedFits`).
 */
export function sameBesideRound(w: Writer, a: Snapshot, b: Snapshot): boolean {
  for (let at = 0; at < STATE.length; at++) {
    if (at !== BRACED && !ROUND_FIELDS.has(STATE[at]!) && !same(a[at], b[at])) return false
  }
  const before = a[BRACED] as Set<Node>
  const after = b[BRACED] as Set<Node>
  if (same(before, after)) return true
  if (w.pass !== null) noteBraced(w.pass, before, after)
  return false
}

function noteBraced(trace: PassTrace, before: Set<Node>, after: Set<Node>): void {
  for (const node of after) if (!before.has(node)) trace.braced.add(node)
  for (const node of before) if (!after.has(node)) trace.braced.add(node)
}

interface PassRecord {
  /** Which step of the repair this records. */
  step: string
  modes: [boolean, boolean, boolean]
  closerKinds: boolean
  wholeTrials: boolean
  trialLog: [TextNode, number][] | null
  trialsRetested: boolean
  /** Where the pass read the log, whether it had retested it at its end. */
  retested: boolean
  start: Snapshot
  end: Snapshot
  trace: PassTrace
  /** What the pass added to `linkPlaced`. */
  placed: Map<TextNode, number[]>
  result: unknown
  chars: number
  rewritten: number
  /** The budget of the repair (C2-W-133), which the start state decides. */
  budget: number
  /** Where its trials of `wholeTests` give no tree, the parses their tests make; null where one does. Taken once, when asked. */
  whole?: Charge[] | null
}

type Charge = [string, DocumentNode | null, boolean]

/** What a pass of the rounds returns: the end of its group, whether it reached a limit of C2-W-133, and its budget. */
export interface PassRun<T> {
  result: T
  limited: boolean
  budget: number
}

/** The passes one group repair ran, with what each started from and ended with. */
export type PassMemo = PassRecord[]

// A snapshot is only read, and `restore` copies out of it, so its empty containers can be shared.
const EMPTY_ARRAY: readonly unknown[] = []
const EMPTY_MAP: ReadonlyMap<unknown, unknown> = new Map()
const EMPTY_SET: ReadonlySet<unknown> = new Set()

/** A copy of `value` that a later write does not change: the containers of the writer copied, nodes kept. */
function copy(value: unknown): unknown {
  if (Array.isArray(value)) {
    if (value.length === 0) return EMPTY_ARRAY
    return (value as unknown[]).map((item) => Array.isArray(item) ? [...(item as unknown[])] : item)
  }
  if (value instanceof Map) {
    if (value.size === 0) return EMPTY_MAP
    const out = new Map<unknown, unknown>()
    for (const [key, item] of value as Map<unknown, unknown>) out.set(key, copyItem(item))
    return out
  }
  if (value instanceof Set) return value.size === 0 ? EMPTY_SET : new Set(value as Set<unknown>)
  if (isLosses(value)) return { ...value, entries: [...value.entries], nodes: [...value.nodes] }
  return value
}

function copyItem(item: unknown): unknown {
  if (Array.isArray(item)) return [...(item as unknown[])]
  if (item instanceof Set) return new Set(item as Set<unknown>)
  if (isAttempt(item)) return { step: item.step, escapes: item.escapes.map((escape) => [...escape]) }
  return item
}

function isAttempt(item: unknown): item is Attempt {
  return typeof item === 'object' && item !== null && !('type' in item) && 'step' in item && 'escapes' in item
}

function isLosses(value: unknown): value is { entries: Diagnostic[], nodes: (Node | null)[] } {
  return typeof value === 'object' && value !== null && !('type' in value) && 'entries' in value && 'nodes' in value
}

/** Whether two copies are the same: containers by their items, nodes and trees by identity. */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) return sameItems(a as unknown[], b as unknown[])
  if (a instanceof Map && b instanceof Map) return sameMaps(a as Map<unknown, unknown>, b as Map<unknown, unknown>)
  if (a instanceof Set && b instanceof Set) return a.size === b.size && [...(a as Set<unknown>)].every((item) => b.has(item))
  if (isAttempt(a) && isAttempt(b)) return a.step === b.step && same(a.escapes, b.escapes)
  if (isLosses(a) && isLosses(b)) return same(a.entries, b.entries) && same(a.nodes, b.nodes)
  return false
}

function sameItems(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((item, at) => same(item, b[at]))
}

function sameMaps(a: Map<unknown, unknown>, b: Map<unknown, unknown>): boolean {
  if (a.size !== b.size) return false
  for (const [key, item] of a) if (!b.has(key) || !same(item, b.get(key))) return false
  return true
}

export function snapshot(w: Writer): Snapshot {
  const taken: Snapshot = new Array(STATE.length)
  for (let at = 0; at < STATE.length; at++) taken[at] = copy(w[STATE[at]!])
  return taken
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  for (let at = 0; at < STATE.length; at++) if (!same(a[at], b[at])) return false
  return true
}

/** Puts a snapshot back, into the containers the writer holds where it has them, as the rounds change them in place. */
export function restore(w: Writer, taken: Snapshot): void {
  const target = w as unknown as Record<string, unknown>
  for (let at = 0; at < STATE.length; at++) {
    const key = STATE[at]!
    const value = taken[at]
    if (!refill(target[key], value)) target[key] = copyOut(value)
  }
}

/** A copy of a snapshot's value the writer can change. */
function copyOut(value: unknown): unknown {
  if (value === EMPTY_ARRAY) return []
  if (value === EMPTY_MAP) return new Map()
  if (value === EMPTY_SET) return new Set()
  return copy(value)
}

/** Fills the container `held` with copies of the items of `value` where both are containers of one kind. */
function refill(held: unknown, value: unknown): boolean {
  if (Array.isArray(held) && Array.isArray(value)) refillArray(held as unknown[], value as unknown[])
  else if (held instanceof Map && value instanceof Map) refillMap(held as Map<unknown, unknown>, value as Map<unknown, unknown>)
  else if (held instanceof Set && value instanceof Set) {
    held.clear()
    for (const item of value as Set<unknown>) held.add(item)
  } else if (isLosses(held) && isLosses(value)) {
    held.entries.splice(0, held.entries.length, ...value.entries)
    held.nodes.splice(0, held.nodes.length, ...value.nodes)
  } else return false
  return true
}

function refillArray(held: unknown[], value: readonly unknown[]): void {
  held.length = 0
  for (const item of value) held.push(Array.isArray(item) ? [...(item as unknown[])] : item)
}

function refillMap(held: Map<unknown, unknown>, value: ReadonlyMap<unknown, unknown>): void {
  held.clear()
  for (const [item, entry] of value) held.set(item, copyItem(entry))
}

/**
 * Runs one pass of the rounds, or another step of the repair, through `memo`. A pass that reached a limit of C2-W-133
 * is not recorded: its result depends on the budget left.
 */
export function memoPass<T>(w: Writer, memo: PassMemo, step: string, run: () => PassRun<T>): T {
  const start = snapshot(w)
  const modes: [boolean, boolean, boolean] = [w.kindRounds, w.bareAlts, w.planKinds]
  const known = memo.find((record) => record.step === step && matches(w, record, modes, start))
  if (known !== undefined && fits(w, known)) {
    replay(w, known, start)
    return known.result as T
  }
  const outer = w.pass
  const before = { chars: w.work.chars, rewritten: w.work.rewritten }
  const trialLog = w.trialLog === null ? null : w.trialLog.map((entry) => [...entry] as [TextNode, number])
  const trialsRetested = w.trialsRetested
  const linkPlaced = new Map([...w.linkPlaced].map(([node, offsets]) => [node, new Set(offsets)]))
  const trace = emptyTrace()
  w.pass = trace
  try {
    const { result, limited, budget } = run()
    if (!limited) {
      memo.push({
        step, modes, closerKinds: w.closerKinds, wholeTrials: w.wholeTrials, trialLog, trialsRetested,
        retested: w.trialsRetested, start, end: snapshot(w), trace, placed: addedSince(linkPlaced, w.linkPlaced), result,
        chars: w.work.chars - before.chars, rewritten: w.work.rewritten - before.rewritten, budget,
      })
    }
    return result
  } finally {
    if (outer !== null) mergeTrace(outer, trace)
    w.pass = outer
  }
}

/**
 * C2-W-125: a pass without `wholeTrials` stands in for one with it where each trial it read the switch for gives no tree
 * and leaves the writer as `isAsked` puts it back: the pass with the switch then runs the same rounds.
 */
function wholeStandsIn(w: Writer, record: PassRecord): boolean {
  if (!w.wholeTrials || record.wholeTrials) return false
  record.whole ??= runWholeTests(w, record.trace.wholeTests)
  return record.whole !== null
}

// The fields `isAsked` puts back after its trials, which `givesTree` may leave changed.
const TRIAL_FIELDS: ReadonlySet<keyof Writer> = new Set<keyof Writer>(['escapes', 'lines', 'lead', 'leadSkip', 'starts'])

// The trials of one pass that are kept for a test; a pass with more runs again.
const MAX_WHOLE_TESTS = 8

/** Keeps a trial a pass without `wholeTrials` read the switch for, with the writer as it stands. */
export function noteWholeTest(w: Writer, gives: () => boolean): void {
  const pass = w.pass
  if (pass === null || pass.wholeTests === null) return
  if (pass.wholeTests.length >= MAX_WHOLE_TESTS) {
    pass.wholeTests = null
    return
  }
  pass.wholeTests.push({ state: snapshot(w), linkPlaced: copyPlaced(w.linkPlaced), work: { ...w.work }, parses: w.parses, gives })
}

function copyPlaced(placed: Map<TextNode, Set<number>>): Map<TextNode, Set<number>> {
  return new Map([...placed].map(([node, offsets]) => [node, new Set(offsets)]))
}

/**
 * Runs `givesTree` for each kept trial from the writer as it stood there, on a parse cache and trace of its own, and
 * puts the writer back. The parses it made, or null where a trial gives the tree or changes the writer.
 */
function runWholeTests(w: Writer, tests: WholeTest[] | null): Charge[] | null {
  if (tests === null) return null
  if (tests.length === 0) return []
  const current = snapshot(w)
  const linkPlaced = copyPlaced(w.linkPlaced)
  const { parseCache, parses, pass } = w
  const work = { ...w.work }
  const charges: Charge[] = []
  try {
    for (const test of tests) {
      restore(w, test.state)
      refillPlaced(w, test.linkPlaced)
      Object.assign(w.work, test.work)
      w.parses = test.parses
      w.parseCache = { trees: new Map(), treeChars: 0, recent: [], kept: parseCache.kept }
      w.pass = emptyTrace()
      const idle = !test.gives() && !exhausted(w) && sameBeside(test.state, snapshot(w), TRIAL_FIELDS) &&
        samePlaced(test.linkPlaced, w.linkPlaced)
      if (!idle) return null
      charges.push(...w.pass.charges)
    }
    return charges
  } finally {
    restore(w, current)
    refillPlaced(w, linkPlaced)
    Object.assign(w.work, work)
    w.parses = parses
    w.parseCache = parseCache
    w.pass = pass
  }
}

function refillPlaced(w: Writer, placed: Map<TextNode, Set<number>>): void {
  w.linkPlaced.clear()
  for (const [node, offsets] of placed) w.linkPlaced.set(node, new Set(offsets))
}

function samePlaced(a: Map<TextNode, Set<number>>, b: Map<TextNode, Set<number>>): boolean {
  if (a.size !== b.size) return false
  for (const [node, offsets] of a) {
    const other = b.get(node)
    if (other === undefined || other.size !== offsets.size || [...offsets].some((at) => !other.has(at))) return false
  }
  return true
}

/** Puts the writer where the recorded pass left it, with what the pass added and charged. */
function replay(w: Writer, known: PassRecord, start: Snapshot): void {
  const whole = wholeStandsIn(w, known)
  restore(w, known.end)
  // The members the start holds beyond the record's are members the pass never found absent (`bracedFits`).
  for (const node of start[BRACED] as Set<Node>) w.bracedAnyway.add(node)
  if (w.pass !== null) for (const node of known.trace.braced) w.pass.braced.add(node)
  for (const [node, offsets] of known.placed) {
    const held = w.linkPlaced.get(node) ?? new Set<number>()
    for (const at of offsets) held.add(at)
    w.linkPlaced.set(node, held)
  }
  for (const trials of known.trace.logged) logTrials(w, trials)
  w.trialsRetested = known.retested
  // The parses the pass would make again are charged as `parseChunk` charges them; a kept probe makes none.
  for (const [src, tree, cacheable] of known.trace.charges) chargeParse(w, src, tree, cacheable)
  if (whole) for (const [src, tree, cacheable] of known.whole ?? []) chargeParse(w, src, tree, cacheable)
  w.parses += known.trace.skipped[0]
  w.work.chars += known.trace.skipped[1]
  w.work.rewritten += known.rewritten
}

/** A step run inside another reports to it too. */
function mergeTrace(outer: PassTrace, inner: PassTrace): void {
  outer.reads |= inner.reads
  const logged = outer.logged.length
  outer.logged.push(...inner.logged)
  outer.checks.push(...inner.checks.map((at) => at + logged))
  outer.charges.push(...inner.charges)
  outer.skipped[0] += inner.skipped[0]
  outer.skipped[1] += inner.skipped[1]
  for (const node of inner.braced) outer.braced.add(node)
  outer.wholeTests = outer.wholeTests === null || inner.wholeTests === null ? null : [...outer.wholeTests, ...inner.wholeTests]
}

function matches(w: Writer, record: PassRecord, modes: [boolean, boolean, boolean], start: Snapshot): boolean {
  if (record.modes.some((mode, at) => mode !== modes[at])) return false
  if ((record.trace.reads & READ_CLOSER_KINDS) !== 0 && record.closerKinds !== w.closerKinds) return false
  const whole = (record.trace.reads & READ_WHOLE_TRIALS) !== 0 && record.wholeTrials !== w.wholeTrials
  if (whole && (!w.wholeTrials || record.trace.wholeTests === null)) return false
  if ((record.trace.reads & READ_TRIAL_LOG) !== 0 &&
    (record.trialsRetested !== w.trialsRetested || !same(record.trialLog, w.trialLog))) return false
  if (record.trace.checks.length > 0 && !closedAtChecks(w, record)) return false
  return sameStart(record, start) && (!whole || wholeStandsIn(w, record))
}

function sameStart(record: PassRecord, start: Snapshot): boolean {
  return sameSnapshot(record.start, start) || (sameBesideBraced(record.start, start) && bracedFits(record, start))
}

/**
 * `bracedAnyway` only grows, and a pass after another starts with the pairs that one braced. Its rounds are those of
 * the record where the start holds every member the record's start held, and each further one is a node the recorded
 * pass never found absent and that never alone told a chain step's states apart: no read or comparison then differs.
 */
function bracedFits(record: PassRecord, start: Snapshot): boolean {
  const recorded = record.start[BRACED] as Set<Node>
  const held = start[BRACED] as Set<Node>
  for (const node of recorded) if (!held.has(node)) return false
  for (const node of held) if (!recorded.has(node) && record.trace.braced.has(node)) return false
  return true
}

function sameBesideBraced(a: Snapshot, b: Snapshot): boolean {
  for (let at = 0; at < STATE.length; at++) if (at !== BRACED && !same(a[at], b[at])) return false
  return true
}

function addedSince(before: Map<TextNode, Set<number>>, after: Map<TextNode, Set<number>>): Map<TextNode, number[]> {
  const added = new Map<TextNode, number[]>()
  for (const [node, offsets] of after) {
    const had = before.get(node)
    const fresh = [...offsets].filter((at) => had?.has(at) !== true)
    if (fresh.length > 0) added.set(node, fresh)
  }
  return added
}

/**
 * A log that is none, retested or past its cap stays closed to a retest whatever is logged after. Whether the log of
 * `w` would be closed at each check of the recorded pass: it grows by the trials the pass logged before the check.
 */
function closedAtChecks(w: Writer, record: PassRecord): boolean {
  if (w.trialLog === null || w.trialsRetested) return true
  const saved = w.trialLog
  w.trialLog = saved.map((entry) => [...entry] as [TextNode, number])
  try {
    let logged = 0
    for (const check of record.trace.checks) {
      for (; logged < check; logged++) logInto(w, record.trace.logged[logged]!)
      if (w.trialLog.length <= MAX_RETESTED_TRIALS) return false
    }
    return true
  } finally {
    w.trialLog = saved
  }
}

/** Notes a check that found the trial log closed to a retest. */
export function noteLogClosed(w: Writer): void {
  w.pass?.checks.push(w.pass.logged.length)
}

/** Whether the recorded work fits what the budget of the repair leaves, so the rounds would not have stopped early. */
function fits(w: Writer, record: PassRecord): boolean {
  const whole = wholeStandsIn(w, record) ? (record.whole ?? []).reduce((total, [src]) => total + src.length, 0) : 0
  return w.work.spent < record.budget && w.work.spent + record.chars + whole <= record.budget &&
    w.work.rewritten + record.rewritten <= record.budget
}

/** Whether two snapshots hold the same state beside the fields `beside`. */
export function sameBeside(a: Snapshot, b: Snapshot, beside: ReadonlySet<keyof Writer>): boolean {
  for (let at = 0; at < STATE.length; at++) if (!beside.has(STATE[at]!) && !same(a[at], b[at])) return false
  return true
}

/** A trace that records nothing of its own, for a step whose parses are counted elsewhere. */
export function emptyTrace(): PassTrace {
  return { reads: 0, logged: [], checks: [], charges: [], skipped: [0, 0], braced: new Set(), wholeTests: [] }
}

/** The trials a pass hands to `logTrials`, in its order: a replayed pass logs them into the log of the pass it stands for. */
export function noteLogged(w: Writer, trials: readonly [TextNode, number][]): void {
  w.pass?.logged.push(trials.map((trial) => [...trial] as [TextNode, number]))
}

/** Notes that the pass read one of its switches (`READ_*`). */
export function noteRead(w: Writer, read: number): void {
  if (w.pass !== null) w.pass.reads |= read
}

/** Records each trial and escape a `wholeTrials` pass asks for once, in the order the rounds asked for it. */
export function logTrials(w: Writer, trials: readonly [TextNode, number][]): void {
  noteLogged(w, trials)
  logInto(w, trials)
}

// The trials a pass tests together at most: the subsets grow as 2^n, and a group that needs more loses the node as before.
export const MAX_RETESTED_TRIALS = 8

/** Adds the trials to the log of a `wholeTrials` pass, each once, up to its cap. */
export function logInto(w: Writer, trials: readonly [TextNode, number][]): void {
  const log = w.trialLog
  if (log === null) return
  for (const [node, at] of trials) {
    // Past the cap the pass is not retested, so the log stops growing and stays short.
    if (log.length > MAX_RETESTED_TRIALS) return
    if (!log.some((entry) => entry[0] === node && entry[1] === at)) log.push([node, at])
  }
}

