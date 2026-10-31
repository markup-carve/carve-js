/**
 * Temporary canonical formatter declarations for changes ahead of the spec pin.
 * Each entry must match current writer output and differ from its pinned golden.
 * Remove a declaration when the pin includes its corrected fixture.
 */
export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ["436-an-empty-description-body-claims-no-line-below-column-0-2", { reason: 'carve#4441 a refused description + needs no escape', fmt: ":: t\n: +\n  flush\n" }],
  ["436-an-empty-description-body-claims-no-line-below-column-0-4", { reason: 'carve#4441 a refused description + needs no escape', fmt: ":: t\n: +\n  flush\n" }],
])
