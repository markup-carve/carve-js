/**
 * Temporary canonical formatter declarations for changes ahead of the spec pin.
 * Each entry must match current writer output and differ from its pinned golden.
 * Remove a declaration when the pin includes its corrected fixture.
 */
export const CANONICAL_AHEAD_OF_PIN: ReadonlyMap<string, { reason: string; fmt: string }> = new Map([
  ["228-a-line-at-a-footnote-definition-s-own-column-followed-by-non-blank-text-forms-its-own-tight-block", { reason: 'carve#3830 shared marker-body ruling', fmt: "- a\n\nsee[^f]\n\n[^f]: x\n  more\n" }],
  ["637-definition-body-note-and-fence-owner-boundaries-4", { reason: 'carve#3843 item-column marker ruling', fmt: ". d\n   [^n]: e\n  - a\n" }],
  ["284-a-ragged-table-keeps-each-row-s-cell-count-2", { reason: 'carve#3784 native table headers', fmt: "|= |= x |\n| y |\n" }],
  ["284-a-ragged-table-keeps-each-row-s-cell-count-3", { reason: 'carve#3784 native table headers', fmt: "|= h |\n| | x |\n" }],
  ["285-adjacent-block-openers-in-an-attached-run-stay-separate-2", { reason: 'carve#3784 native table headers', fmt: "- x\n+\n|= a |\n| b |\n+\n|= a |\n| b |\n" }],
  ["99-table-cell-attributes", { reason: 'carve#3784 native table headers', fmt: "|={.highlight} Total |= 99 |\n| a | b |\n" }],
])
