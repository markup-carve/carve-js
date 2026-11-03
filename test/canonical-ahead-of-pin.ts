/**
 * Temporary canonical formatter declarations for changes ahead of the spec pin.
 * Each entry must match current writer output and differ from its pinned golden.
 * Remove a declaration when the pin includes its corrected fixture.
 */
import { RULED_FMT_AHEAD_OF_PIN } from './ruled-ahead-of-pin-5015.js'
import { RULED_5013_FMT } from './ruled-5013-ahead-of-pin.js'

export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ...RULED_FMT_AHEAD_OF_PIN,
  ...RULED_5013_FMT,
])
