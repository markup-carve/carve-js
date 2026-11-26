// C2-W-088, C2-W-133 (carve-js#5666): a closer that a round frees takes the nearest open bracket before it, so a
// construct whose opener the round escapes can form again from the bracket before it, one per round, across the
// lines of a paragraph. Where two rounds in a row did nothing but escape the opener of such a construct, the rounds
// that would follow are taken as a batch of the brackets before it, and one real round decides whether the procedure
// would have reached that state: it must ask, as its only change, for the next bracket. Where it does not, the batch
// is halved down to the round-by-round procedure. The skipped rounds are charged to the budget as they would be.
import { type Node, type TextNode, forEachSlot, SOURCE_ORDER } from './ast.ts'
import { logTrials, restore, sameBesideRound, type Snapshot, snapshot } from './write-passes.ts'
import { type Writer } from './write-state.ts'
import { CACHED_SOURCE } from './write-check.ts'

type Escape = [TextNode, number]

/** What one round of the repair did, as far as a chain step reads it. */
export interface RoundStep {
  /** The opener escape of a round whose only change was that escape, else null. */
  escape: Escape | null
  /** The characters of the round's parse source, and of its written lines. */
  source: number
  written: number
  chars: number
  parses: number
  logged: number
  checks: number
  charges: number
}

/** The repair history fields a batch moves on (write.ts `RepairHistory`). */
export interface ChainHistory {
  recent: string[]
  seen: Set<string>
  rounds: number
  budget: number
  limited: boolean
}

interface Batch {
  state: Snapshot
  history: { recent: string[], seen: Set<string>, rounds: number, limited: boolean }
  work: { chars: number, rewritten: number, parses: number }
  trace: { logged: number, checks: number, charges: number, skipped: [number, number] }
  trialLog: Escape[] | null
  trialsRetested: boolean
  /** The index in `candidates` of the first bracket of the batch, and its size. */
  from: number
  size: number
  /** The parse length of the state the batch starts from, and how much longer it is than its lines. */
  source: number
  margin: number
  /** The logged entries of one chain round: whether each is empty or the round's escape. */
  pattern: boolean[]
  charged: number
}

export interface Chain {
  /** The escape of the last round where it was a chain step, else null. */
  last: Escape | null
  candidates: Escape[]
  next: number
  size: number
  batch: Batch | null
  /** Parse characters of rounds a batch made and took back, and of rounds it stood in for. */
  wasted: number
  saved: number
}

const MAX_ROUNDS = 8192

export function createChain(): Chain {
  return { last: null, candidates: [], next: 0, size: 0, batch: null, wasted: 0, saved: 0 }
}

/** The state before a round, where the round may continue a chain. */
export function watchRound(w: Writer, chain: Chain): Snapshot | null {
  return chain.last !== null || chain.batch !== null ? snapshot(w) : null
}

export function startRound(w: Writer): RoundStep {
  return {
    escape: null, source: 0, written: 0, chars: w.work.chars, parses: w.parses, logged: w.pass?.logged.length ?? 0,
    checks: w.pass?.checks.length ?? 0, charges: w.pass?.charges.length ?? 0,
  }
}

/**
 * Whether the round, which did nothing but escape `step.escape`, is a chain step: one parse of its source, the logged
 * trials nothing but its escape, and no state beside the escapes changed.
 */
function chainStep(w: Writer, step: RoundStep, before: Snapshot | null): boolean {
  const escape = step.escape
  if (escape === null || w.pass === null) return false
  if (w.parses !== step.parses + 1 || w.work.chars !== step.chars + step.source) return false
  if (w.pass.checks.length !== step.checks) return false
  for (const entry of w.pass.logged.slice(step.logged)) {
    if (entry.length > 1 || (entry.length === 1 && (entry[0]![0] !== escape[0] || entry[0]![1] !== escape[1]))) return false
  }
  if (before === null) return true
  const after = snapshot(w)
  if (!sameBesideRound(before, after)) return false
  return addedOnly(before.get('escapes') as Map<TextNode, number[]>, w.escapes, escape)
}

/** Whether `after` is `before` with the one escape added. */
function addedOnly(before: Map<TextNode, number[]>, after: Map<TextNode, number[]>, [node, at]: Escape): boolean {
  if (after.size !== before.size + (before.has(node) ? 0 : 1)) return false
  for (const [text, offsets] of after) {
    const had = before.get(text) ?? []
    if (text !== node) {
      if (had.length !== offsets.length || had.some((offset, k) => offset !== offsets[k])) return false
    } else if (offsets.length !== had.length + 1 || !offsets.includes(at) || had.some((offset) => !offsets.includes(offset))) {
      return false
    }
  }
  return true
}

/**
 * After a round that continues: takes or takes back a batch, or starts one. Returns false where the round was a batch
 * the procedure would not have reached, which is then taken back.
 */
export function advanceChain(w: Writer, chain: Chain, history: ChainHistory, group: readonly Node[],
  before: Snapshot | null, step: RoundStep, settled: boolean): boolean {
  const pure = settled && chainStep(w, step, before)
  const batch = chain.batch
  if (batch !== null) {
    const expected = chain.candidates[batch.from + batch.size]
    if (pure && expected !== undefined && step.escape![0] === expected[0] && step.escape![1] === expected[1] &&
      step.source === batch.source + batch.size) {
      chain.saved += batch.charged
      chain.batch = null
      chain.next = batch.from + batch.size + 1
      chain.size = batch.size * 2
      chain.last = step.escape
      startBatch(w, chain, history, step)
      return true
    }
    takeBack(w, chain, history, batch)
    chain.size = batch.size >> 1
    chain.next = batch.from
    if (chain.size > 0) {
      startBatch(w, chain, history, { ...step, source: batch.source - 1, written: batch.source - 1 - batch.margin }, batch.pattern)
    }
    else chain.last = null
    return false
  }
  if (!pure) {
    chain.last = null
    return true
  }
  if (before === null || chain.last === null) {
    chain.last = step.escape
    return true
  }
  chain.candidates = openersBefore(w, group, step.escape!)
  chain.next = 0
  chain.size = 2
  chain.last = step.escape
  startBatch(w, chain, history, step)
  return true
}

/** The logged entries of the round in `step`: whether each holds its escape. */
function loggedPattern(w: Writer, step: RoundStep): boolean[] {
  return (w.pass?.logged.slice(step.logged) ?? []).map((entry) => entry.length === 1)
}

/**
 * Places the next `chain.size` brackets at once, for the rounds that would place them one each, and charges those
 * rounds. `step` is the chain round just made, whose escape is placed: its source is one shorter than the next one.
 */
function startBatch(w: Writer, chain: Chain, history: ChainHistory, step: RoundStep, pattern = loggedPattern(w, step)): void {
  // One bracket stays behind the batch: the round after it must ask for that one.
  let size = Math.min(chain.size, chain.candidates.length - chain.next - 1)
  const source = step.source + 1
  const margin = step.source - step.written
  // Each skipped round writes and parses one escape more than the one before it.
  const charge = (count: number, base: number): number => count * base + (count * (count - 1)) / 2
  // The batch and the round after it fit what the budget leaves, so no skipped round would have stopped the rounds.
  while (size > 0 && (w.work.chars + charge(size + 1, source) > w.work.limit ||
    w.work.rewritten + charge(size + 1, source - margin) > history.budget || history.rounds + size + 1 > MAX_ROUNDS)) {
    size >>= 1
  }
  // A batch the procedure did not reach costs a round; past the work saved and the group's own size, none starts.
  if (size <= 0 || chain.wasted > chain.saved + 4 * source) {
    chain.batch = null
    return
  }
  const pass = w.pass!
  chain.batch = {
    state: snapshot(w),
    history: { recent: [...history.recent], seen: new Set(history.seen), rounds: history.rounds, limited: history.limited },
    work: { chars: w.work.chars, rewritten: w.work.rewritten, parses: w.parses },
    trace: { logged: pass.logged.length, checks: pass.checks.length, charges: pass.charges.length, skipped: [...pass.skipped] },
    trialLog: w.trialLog === null ? null : w.trialLog.map((entry) => [entry[0], entry[1]] as Escape),
    trialsRetested: w.trialsRetested,
    from: chain.next, size, source, margin, pattern, charged: charge(size, source),
  }
  const placed = chain.candidates.slice(chain.next, chain.next + size)
  addEscapes(w, placed)
  history.rounds += size
  w.parses += size
  w.work.chars += charge(size, source)
  w.work.rewritten += charge(size, source - margin)
  // A pass that stands in for this one finds a short source in the parse cache, as `chargeParse` does.
  if (source + size > CACHED_SOURCE) {
    pass.skipped[0] += size
    pass.skipped[1] += charge(size, source)
  }
  for (const escape of placed) for (const holds of pattern) logTrials(w, holds ? [escape] : [])
}

function takeBack(w: Writer, chain: Chain, history: ChainHistory, batch: Batch): void {
  chain.wasted += w.work.chars - batch.work.chars
  restore(w, batch.state)
  history.recent.splice(0, history.recent.length, ...batch.history.recent)
  history.seen.clear()
  for (const key of batch.history.seen) history.seen.add(key)
  history.rounds = batch.history.rounds
  history.limited = batch.history.limited
  w.work.chars = batch.work.chars
  w.work.rewritten = batch.work.rewritten
  w.parses = batch.work.parses
  const pass = w.pass!
  pass.logged.length = batch.trace.logged
  pass.checks.length = batch.trace.checks
  pass.charges.length = batch.trace.charges
  pass.skipped = [...batch.trace.skipped]
  w.trialLog = batch.trialLog
  w.trialsRetested = batch.trialsRetested
  chain.batch = null
}

/**
 * The bare `[` of the group's text before `escape`, nearest first, that no bare `]` between closes: the brackets a
 * closer freed by the escape would take in turn. A bracket this misreads costs a round that is taken back.
 */
function openersBefore(w: Writer, group: readonly Node[], [node, at]: Escape): Escape[] {
  const texts: TextNode[] = []
  const collect = (nodes: readonly Node[]): boolean => {
    for (const child of nodes) {
      if (child.type === 'text') {
        texts.push(child)
        if (child === node) return true
      }
      let found = false
      forEachSlot(child, (slot) => { if (!found) found = collect(slot) }, SOURCE_ORDER)
      if (found) return true
    }
    return false
  }
  if (!collect(group)) return []
  const openers: Escape[] = []
  let depth = 0
  for (let k = texts.length - 1; k >= 0; k--) {
    const text = texts[k]!
    const escaped = new Set(w.escapes.get(text))
    for (let i = (text === node ? at : text.value.length) - 1; i >= 0; i--) {
      const char = text.value[i]
      if ((char !== '[' && char !== ']') || escaped.has(i)) continue
      if (char === ']') depth++
      else if (depth > 0) depth--
      else openers.push([text, i])
    }
  }
  return openers
}

function addEscapes(w: Writer, added: readonly Escape[]): void {
  for (const [node, at] of added) {
    const list = w.escapes.get(node) ?? []
    let k = 0
    while (k < list.length && list[k]! < at) k++
    if (list[k] !== at) w.escapes.set(node, [...list.slice(0, k), at, ...list.slice(k)])
  }
}
