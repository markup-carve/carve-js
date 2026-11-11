/**
 * Temporary canonical formatter declarations for changes ahead of the spec pin.
 * Each entry must match current writer output and differ from its pinned golden.
 * Remove a declaration when the pin includes its corrected fixture.
 */
import { RULED_FMT_AHEAD_OF_PIN } from './ruled-ahead-of-pin-5015.js'
import { RULED_5013_FMT } from './ruled-5013-ahead-of-pin.js'
import { RULED_FMT_AHEAD_OF_PIN_5012 } from './ruled-ahead-of-pin-5012.js'
import { RULED_FMT_AHEAD_OF_PIN_5091 } from './ruled-ahead-of-pin-5091.js'
import { RULED_FMT_AHEAD_OF_PIN_5109 } from './ruled-5109-ahead-of-pin.js'

export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ...RULED_FMT_AHEAD_OF_PIN,
  ...RULED_5013_FMT,
  ...RULED_FMT_AHEAD_OF_PIN_5012,
  ...RULED_FMT_AHEAD_OF_PIN_5091,
  ...RULED_FMT_AHEAD_OF_PIN_5109,
])

// Existing formatter lag exposed by the #5735 spec pin; owned by layout rewrite #5731.
export const CANONICAL_BEHIND_SPEC: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ['279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-2', { reason: 'F06 writer drift, carve#5716 sidecar keeps source order', fmt: "b\n\n```\n\nsee[^f]\n```\n\n[^f]: n\n\n  ```\n  a\n\n  ```\n" }],
  ['279-a-boundary-line-inside-an-open-fence-does-not-end-the-container-3', { reason: 'F06 writer drift, carve#5716 sidecar keeps source order', fmt: ":: t\n: d\n\n  ```\n  a\n\n  ```\n\nb\n\n```\n```\n" }],
])
