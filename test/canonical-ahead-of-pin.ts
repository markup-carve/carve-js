/**
 * Temporary canonical formatter declarations for changes ahead of the spec pin.
 * Each entry must match current writer output and differ from its pinned golden.
 * Remove a declaration when the pin includes its corrected fixture.
 * The map is empty after the published table separator rollout.
 */
export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map()
