/**
 * Temporary canonical formatter declarations for changes ahead of the spec pin.
 * Each entry must match current writer output and differ from its pinned golden.
 * Remove a declaration when the pin includes its corrected fixture.
 * The map is empty after the published table separator rollout.
 */
export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ["228-a-line-at-a-footnote-definition-s-own-column-followed-by-non-blank-text-forms-its-own-tight-block", { reason: 'carve#3830 shared marker-body ruling', fmt: "- a\n\nsee[^f]\n\n[^f]: x\n  more\n" }],
  ["637-definition-body-note-and-fence-owner-boundaries-4", { reason: 'carve#3830 shared marker-body ruling', fmt: ". d\n\n[^n]: e\n  - a\n" }],
])
