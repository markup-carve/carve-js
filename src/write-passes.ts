// C2-W-088, C2-W-133: the passes of one group repair start again and again from the same saved state. A pass whose
// state and the switches it read are those of an earlier pass of the same repair takes that pass's result instead of
// running its rounds again. It is charged the parses a rerun would make, and where the recorded work would pass the
// budget it runs.
import { type Node, type TextNode } from './ast.ts'
import { type Diagnostic } from './diagnostics.ts'
import { type Attempt, type PassTrace, type Writer } from './write-state.ts'
import { chargeParse } from './write-check.ts'

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
  labelReads: 'cache', probes: 'cache', nodeIds: 'cache', standIns: 'cache', lineOpens: 'cache', work: 'work',
  leadingFrontmatter: 'fixed', pass: 'work',
}

const STATE = (Object.keys(FIELDS) as (keyof Writer)[]).filter((key) => FIELDS[key] === 'state')

export type Snapshot = Map<keyof Writer, unknown>

// The fields each round writes anew, and the escapes, which a chain step compares itself (write-chain.ts).
const ROUND_FIELDS: ReadonlySet<keyof Writer> = new Set<keyof Writer>([
  'lines', 'lead', 'leadSkip', 'bareDotLead', 'glued', 'starts', 'prewrittenAttributes', 'parsed', 'escapes',
])

/** Whether two snapshots hold the same state beside what each round writes anew and the escapes. */
export function sameBesideRound(a: Snapshot, b: Snapshot): boolean {
  for (const key of STATE) if (!ROUND_FIELDS.has(key) && !same(a.get(key), b.get(key))) return false
  return true
}

interface PassRecord {
  /** Which step of the repair this records: a pass of the rounds or the check after one. */
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
}

/** What a pass of the rounds returns: the end of its group, whether it reached a limit of C2-W-133, and its budget. */
export interface PassRun<T> {
  result: T
  limited: boolean
  budget: number
}

/** The passes one group repair ran, with what each started from and ended with. */
export type PassMemo = PassRecord[]

/** A copy of `value` that a later write does not change: the containers of the writer copied, nodes kept. */
function copy(value: unknown): unknown {
  if (Array.isArray(value)) return (value as unknown[]).map((item) => Array.isArray(item) ? [...(item as unknown[])] : item)
  if (value instanceof Map) {
    const out = new Map<unknown, unknown>()
    for (const [key, item] of value as Map<unknown, unknown>) out.set(key, copyItem(item))
    return out
  }
  if (value instanceof Set) return new Set(value as Set<unknown>)
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
  const taken: Snapshot = new Map()
  for (const key of STATE) taken.set(key, copy(w[key]))
  return taken
}

function sameSnapshot(a: Snapshot, b: Snapshot): boolean {
  for (const key of STATE) if (!same(a.get(key), b.get(key))) return false
  return true
}

/** Puts a snapshot back, into the containers the writer holds where it has them, as the rounds change them in place. */
export function restore(w: Writer, taken: Snapshot): void {
  const target = w as unknown as Record<string, unknown>
  for (const key of STATE) {
    const value = copy(taken.get(key))
    if (!refill(target[key], value)) target[key] = value
  }
}

/** Fills the container `held` with the items of `value` where both are containers of one kind. */
function refill(held: unknown, value: unknown): boolean {
  if (Array.isArray(held) && Array.isArray(value)) {
    held.splice(0, held.length, ...(value as unknown[]))
  } else if (held instanceof Map && value instanceof Map) {
    held.clear()
    for (const [item, entry] of value as Map<unknown, unknown>) held.set(item, entry)
  } else if (held instanceof Set && value instanceof Set) {
    held.clear()
    for (const item of value as Set<unknown>) held.add(item)
  } else if (isLosses(held) && isLosses(value)) {
    held.entries.splice(0, held.entries.length, ...value.entries)
    held.nodes.splice(0, held.nodes.length, ...value.nodes)
  } else return false
  return true
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
    restore(w, known.end)
    for (const [node, offsets] of known.placed) {
      const held = w.linkPlaced.get(node) ?? new Set<number>()
      for (const at of offsets) held.add(at)
      w.linkPlaced.set(node, held)
    }
    for (const trials of known.trace.logged) logTrials(w, trials)
    w.trialsRetested = known.retested
    // The parses the pass would make again are charged as `parseChunk` charges them; a kept probe makes none.
    for (const [src, tree, cacheable] of known.trace.charges) chargeParse(w, src, tree, cacheable)
    w.parses += known.trace.skipped[0]
    w.work.chars += known.trace.skipped[1]
    w.work.rewritten += known.rewritten
    return known.result as T
  }
  const outer = w.pass
  const before = { chars: w.work.chars, rewritten: w.work.rewritten }
  const trialLog = w.trialLog === null ? null : w.trialLog.map((entry) => [...entry] as [TextNode, number])
  const trialsRetested = w.trialsRetested
  const linkPlaced = new Map([...w.linkPlaced].map(([node, offsets]) => [node, new Set(offsets)]))
  const trace: PassTrace = { reads: 0, logged: [], checks: [], charges: [], skipped: [0, 0] }
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

/** A step run inside another reports to it too. */
function mergeTrace(outer: PassTrace, inner: PassTrace): void {
  outer.reads |= inner.reads
  const logged = outer.logged.length
  outer.logged.push(...inner.logged)
  outer.checks.push(...inner.checks.map((at) => at + logged))
  outer.charges.push(...inner.charges)
  outer.skipped[0] += inner.skipped[0]
  outer.skipped[1] += inner.skipped[1]
}

function matches(w: Writer, record: PassRecord, modes: [boolean, boolean, boolean], start: Snapshot): boolean {
  if (record.modes.some((mode, at) => mode !== modes[at])) return false
  if ((record.trace.reads & READ_CLOSER_KINDS) !== 0 && record.closerKinds !== w.closerKinds) return false
  if ((record.trace.reads & READ_WHOLE_TRIALS) !== 0 && record.wholeTrials !== w.wholeTrials) return false
  if ((record.trace.reads & READ_TRIAL_LOG) !== 0 &&
    (record.trialsRetested !== w.trialsRetested || !same(record.trialLog, w.trialLog))) return false
  if (record.trace.checks.length > 0 && !closedAtChecks(w, record)) return false
  return sameSnapshot(record.start, start)
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
  return w.work.spent < record.budget && w.work.spent + record.chars <= record.budget &&
    w.work.rewritten + record.rewritten <= record.budget
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

