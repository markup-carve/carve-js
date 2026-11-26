// The rule every hold list of a gate follows (scripts/corpus-held.ts): a case the gate fails passes only when it is held,
// and a held case the gate passes, or never sees, is a stale hold that fails the gate.

/** The case ids a gate does not pass yet, each with the ticket that fixes it. */
export type Holds = ReadonlyMap<string, string>

/** What one gate's results come to against its hold list. */
export interface Judged<T> {
  /** The failures the list does not hold. */
  readonly failures: readonly (readonly [string, T])[]
  /** The held ids that pass or that the gate never saw, each with why the hold is stale. */
  readonly stale: readonly string[]
  readonly held: number
}

/**
 * Judges the result of each case of a gate, null for a pass. `partial` is for a sampled run, where a held id the gate did
 * not see is no stale hold.
 */
export function judgeHolds<T>(results: Iterable<readonly [string, T | null]>, holds: Holds, partial = false): Judged<T> {
  const failures: (readonly [string, T])[] = []
  const stale: string[] = []
  const seen = new Set<string>()
  let held = 0
  for (const [id, failure] of results) {
    seen.add(id)
    const fix = holds.get(id)
    if (fix === undefined) {
      if (failure !== null) failures.push([id, failure])
    } else if (failure === null) stale.push(`${id}: held (${fix}) but passes; drop the hold`)
    else held++
  }
  if (!partial) for (const [id, fix] of holds) if (!seen.has(id)) stale.push(`${id}: held (${fix}) but not a case of this gate`)
  return { failures, stale, held }
}

/** Runs a test body of plain assertions: as it is when the id is not held, and as a held case that must still fail when it is. */
export function expectHeld(id: string, holds: Holds, body: () => void): void {
  const fix = holds.get(id)
  if (fix === undefined) {
    body()
    return
  }
  try {
    body()
  } catch {
    return
  }
  throw new Error(`${id}: held (${fix}) but passes; drop the hold`)
}
